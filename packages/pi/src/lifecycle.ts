import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, realpath } from "node:fs/promises"
import path from "node:path"

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { ConflictError, NotFoundError } from "@superserve/sdk"

import {
  CREATED_BY,
  DEFAULT_AUTO_DELETE_SECONDS,
  DEFAULT_TEMPLATE,
  DEFAULT_TIMEOUT_SECONDS,
  GUEST_WORKSPACE,
  MAX_WORKSPACE_DOWNLOAD_BYTES,
  ROUTED_TOOL_NAMES,
  SESSION_ENTRY_TYPE,
  SESSION_ENTRY_VERSION,
} from "./constants.js"
import { defaultSandboxProvider } from "./provider.js"
import type {
  ActiveSandbox,
  SandboxBinding,
  SandboxBootstrap,
  SandboxHandle,
  SandboxProvider,
  SandboxRuntimeOptions,
} from "./types.js"
import { bootstrapSandbox } from "./workspace.js"

type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork"
type SessionShutdownReason = "quit" | "reload" | "new" | "resume" | "fork"

export interface LifecycleDependencies {
  provider?: SandboxProvider
  bootstrap?: SandboxBootstrap
  now?: () => Date
  randomId?: () => string
  sleep?: (milliseconds: number) => Promise<void>
}

export class SandboxLifecycle {
  private readonly provider: SandboxProvider
  private readonly bootstrap: SandboxBootstrap
  private readonly now: () => Date
  private readonly randomId: () => string
  private readonly sleep: (milliseconds: number) => Promise<void>
  private active: ActiveSandbox | undefined
  private binding: SandboxBinding | undefined
  private transition: Promise<ActiveSandbox> | undefined
  private enabled = false
  private carryIntent = false
  private initializationError: Error | undefined
  private currentSessionPersistent = false
  private currentCwd: string
  private invocationOptIn = false

  constructor(
    private readonly pi: ExtensionAPI,
    localCwd: string,
    dependencies: LifecycleDependencies = {},
  ) {
    this.currentCwd = localCwd
    this.provider = dependencies.provider ?? defaultSandboxProvider
    this.bootstrap = dependencies.bootstrap ?? bootstrapSandbox
    this.now = dependencies.now ?? (() => new Date())
    this.randomId = dependencies.randomId ?? randomUUID
    this.sleep =
      dependencies.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  isEnabled(): boolean {
    return this.enabled
  }

  getActive(): ActiveSandbox | undefined {
    return this.active
  }

  getBinding(): SandboxBinding | undefined {
    return this.binding
  }

  hasFlagIntent(): boolean {
    return (
      this.pi.getFlag("superserve") === true ||
      this.getStringFlag("superserve-sandbox") !== undefined
    )
  }

  async start(
    reason: SessionStartReason,
    ctx: ExtensionContext,
  ): Promise<void> {
    this.currentCwd = ctx.cwd
    this.active = undefined
    this.transition = undefined
    this.initializationError = undefined
    this.currentSessionPersistent =
      ctx.sessionManager.getSessionFile() !== undefined

    const ownerSessionId = ctx.sessionManager.getSessionId()
    const persisted = findPersistedBindings(ctx, ownerSessionId)
    const restored = persisted.restored
    const inherited = persisted.inherited
    const flagIntent = this.hasFlagIntent()
    this.invocationOptIn = this.carryIntent || flagIntent
    this.enabled =
      this.invocationOptIn ||
      restored !== undefined ||
      inherited !== undefined ||
      persisted.error !== undefined
    this.carryIntent = false
    this.binding = restored

    if (!this.enabled) {
      clearStatus(ctx)
      return
    }

    this.pi.setActiveTools([...ROUTED_TOOL_NAMES])
    setStatus(ctx, "Superserve: connecting")

    try {
      if (!this.invocationOptIn) {
        throw new Error(
          "This session contains a Superserve sandbox binding, but this Pi invocation did not opt in. Restart Pi with --superserve to reconnect; sandbox tools remain fail-closed.",
        )
      }
      if (persisted.error) throw persisted.error
      const explicitSandboxFlag = this.getStringFlag("superserve-sandbox")
      let explicitSandboxId: string | undefined
      if (explicitSandboxFlag !== undefined) {
        // An explicit target must never fall back to an older restored binding,
        // including when the new value itself is malformed.
        this.binding = undefined
        explicitSandboxId = requireSandboxId(
          explicitSandboxFlag,
          "--superserve-sandbox",
        )
      }

      if (reason === "fork" || (restored === undefined && inherited)) {
        await this.provisionNew(this.readRuntimeOptions(), ctx)
      } else if (explicitSandboxId !== undefined) {
        if (
          restored?.sandboxId !== undefined &&
          sameSandboxIdentity(restored.sandboxId, explicitSandboxId) &&
          restored.state !== "destroyed"
        ) {
          this.binding = restored
          await this.connectBinding(restored, ctx, false)
        } else {
          await this.attach(explicitSandboxId, ctx)
        }
      } else if (restored?.state === "provisioning") {
        await this.reconcileProvisioning(restored, ctx)
      } else if (restored?.state === "attaching") {
        await this.connectBinding(restored, ctx, false)
      } else if (restored?.state === "active" || restored?.state === "paused") {
        await this.connectBinding(restored, ctx, true)
      } else if (restored?.state === "destroyed") {
        throw new Error(
          "This session's Superserve sandbox was destroyed. Run /superserve new to create another one.",
        )
      } else {
        await this.provisionNew(this.readRuntimeOptions(), ctx)
      }
    } catch (error) {
      this.initializationError = toError(error)
      setStatus(ctx, "Superserve: unavailable", "warning")
      notify(ctx, formatError(this.initializationError), "error")
    }
  }

  async shutdown(
    reason: SessionShutdownReason,
    ctx: ExtensionContext,
  ): Promise<void> {
    this.carryIntent = this.invocationOptIn && reason !== "quit"
    const active = this.active
    const binding = this.binding
    this.active = undefined
    this.transition = undefined
    this.initializationError = undefined
    clearStatus(ctx)

    if (!this.enabled || !active || !binding) return
    if (reason === "reload") return

    try {
      if (this.currentSessionPersistent || !binding.managed) {
        await active.sandbox.pause()
        this.binding = this.appendBinding({ ...binding, state: "paused" })
      } else {
        await active.sandbox.kill()
        this.binding = this.appendBinding({ ...binding, state: "destroyed" })
      }
    } catch (error) {
      notify(
        ctx,
        `Could not release Superserve sandbox ${active.sandbox.id}: ${formatError(error)}`,
        "warning",
      )
    }
  }

  async requireSandbox(ctx?: ExtensionContext): Promise<ActiveSandbox> {
    if (ctx) this.currentCwd = ctx.cwd
    if (!this.enabled) {
      throw new Error("Superserve sandbox mode is not enabled")
    }
    if (!this.invocationOptIn) {
      throw this.unavailableError()
    }
    if (this.active) return this.active
    if (this.transition) return this.transition

    const binding = this.binding
    if (!binding) {
      throw this.unavailableError()
    }
    if (binding.state === "destroyed") {
      throw new Error(
        "Superserve sandbox was destroyed. The command was not run on the host. Run /superserve new.",
      )
    }
    if (binding.state === "missing") {
      throw new Error(
        "Superserve sandbox is missing. The command was not run on the host. Run /superserve new.",
      )
    }

    this.transition = (
      binding.state === "provisioning"
        ? this.reconcileProvisioning(binding, ctx)
        : this.connectBinding(binding, ctx, false)
    ).finally(() => {
      this.transition = undefined
    })
    return this.transition
  }

  async createNew(ctx: ExtensionContext): Promise<ActiveSandbox> {
    this.currentCwd = ctx.cwd
    this.enableSecureMode()
    const options = this.readRuntimeOptions()
    if (this.active && this.binding) {
      await this.active.sandbox.pause()
      this.binding = this.appendBinding({
        ...this.binding,
        state: "paused",
      })
      this.active = undefined
    }
    this.initializationError = undefined
    return this.provisionNew(options, ctx)
  }

  async connect(
    sandboxId: string,
    ctx: ExtensionContext,
  ): Promise<ActiveSandbox> {
    this.currentCwd = ctx.cwd
    const trimmed = sandboxId.trim()
    if (!trimmed) throw new Error("Usage: /superserve connect <sandbox-id>")
    this.enableSecureMode()
    const validatedSandboxId = requireSandboxId(trimmed, "/superserve connect")
    if (this.active && this.binding) {
      await this.active.sandbox.pause()
      this.binding = this.appendBinding({
        ...this.binding,
        state: "paused",
      })
      this.active = undefined
    }
    this.initializationError = undefined
    return this.attach(validatedSandboxId, ctx)
  }

  async pause(ctx: ExtensionContext): Promise<void> {
    const active = await this.requireSandbox(ctx)
    await active.sandbox.pause()
    this.binding = this.appendBinding({
      ...active.binding,
      state: "paused",
    })
    this.active = undefined
    setStatus(ctx, `Superserve: paused ${shortId(active.sandbox.id)}`)
  }

  async kill(ctx: ExtensionContext): Promise<void> {
    if (!this.enabled || !this.invocationOptIn) {
      throw new Error(
        "Superserve sandbox mode is not enabled for this invocation",
      )
    }
    const binding = this.binding
    if (!binding?.sandboxId) {
      throw new Error("No Superserve sandbox is bound to this session")
    }
    const sandboxId = requireSandboxId(
      binding.sandboxId,
      "persisted Superserve binding",
    )
    if (this.active) await this.active.sandbox.kill()
    else await this.provider.killById(sandboxId)
    this.active = undefined
    this.binding = this.appendBinding({ ...binding, state: "destroyed" })
    setStatus(ctx, "Superserve: destroyed", "warning")
  }

  async list(): Promise<
    Array<{ id: string; name: string; status: string; createdAt: Date }>
  > {
    const sandboxes = await this.provider.list({
      metadata: { "created-by": CREATED_BY },
    })
    return sandboxes.map((sandbox) => ({
      id: requireSandboxId(sandbox.id, "Superserve list response"),
      name: sandbox.name,
      status: sandbox.status,
      createdAt: sandbox.createdAt,
    }))
  }

  async downloadWorkspace(
    output: string | undefined,
    ctx: ExtensionContext,
  ): Promise<{ path: string; bytes: number }> {
    this.currentCwd = ctx.cwd
    const active = await this.requireSandbox(ctx)
    const outputPath = resolveDownloadPath(
      this.currentCwd,
      output?.trim() ||
        `superserve-${shortId(active.sandbox.id)}-workspace.zip`,
    )
    const downloadTarget = await createDownloadParent(
      this.currentCwd,
      outputPath,
    )
    const archive = await active.sandbox.files.downloadDir(GUEST_WORKSPACE, {
      timeoutMs: 300_000,
      signal: ctx.signal,
      maxBytes: MAX_WORKSPACE_DOWNLOAD_BYTES,
    })
    await revalidateDownloadParent(downloadTarget)
    const file = await open(downloadTarget.filePath, "wx", 0o600)
    try {
      await file.writeFile(archive)
    } finally {
      await file.close()
    }
    return { path: outputPath, bytes: archive.byteLength }
  }

  statusLines(): string[] {
    if (!this.enabled) return ["Superserve mode: disabled"]
    const binding = this.binding
    return [
      "Superserve mode: enabled (fail-closed)",
      `Sandbox: ${binding?.sandboxId ?? "unavailable"}`,
      `State: ${binding?.state ?? "initialization failed"}`,
      `Workspace: ${GUEST_WORKSPACE}`,
      `Template: ${binding?.template ?? "external sandbox"}`,
      "Network egress: provider default (currently unrestricted)",
    ]
  }

  private enableSecureMode(): void {
    this.enabled = true
    this.invocationOptIn = true
    this.pi.setActiveTools([...ROUTED_TOOL_NAMES])
  }

  private async provisionNew(
    options: SandboxRuntimeOptions,
    ctx?: ExtensionContext,
  ): Promise<ActiveSandbox> {
    const timestamp = this.now().toISOString()
    const binding: SandboxBinding = {
      version: SESSION_ENTRY_VERSION,
      ownerSessionId:
        ctx?.sessionManager.getSessionId() ??
        this.binding?.ownerSessionId ??
        this.randomId(),
      clientId: this.randomId(),
      bindingId: this.randomId(),
      state: "provisioning",
      managed: true,
      workspacePath: GUEST_WORKSPACE,
      template: options.template,
      timeoutSeconds: options.timeoutSeconds,
      autoDeleteSeconds: options.autoDeleteSeconds,
      sync: options.sync,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.binding = this.appendBinding(binding)
    return this.provision(binding, options, ctx)
  }

  private async provision(
    binding: SandboxBinding,
    options: SandboxRuntimeOptions,
    ctx?: ExtensionContext,
  ): Promise<ActiveSandbox> {
    let sandbox: SandboxHandle | undefined
    let sandboxId: string | undefined
    const localCwd = ctx?.cwd ?? this.currentCwd
    this.currentCwd = localCwd
    try {
      setStatus(ctx, `Superserve: creating ${options.template}`)
      sandbox = await this.provider.create({
        name: sandboxName(localCwd, binding.bindingId),
        fromTemplate: options.template,
        timeoutSeconds: options.timeoutSeconds,
        autoDeleteSeconds: options.autoDeleteSeconds,
        metadata: metadataFor(binding),
        signal: ctx?.signal,
      })
      sandboxId = requireSandboxId(sandbox.id, "Superserve create response")
      const initialized = await this.bootstrap(sandbox, {
        localCwd,
        sync: options.sync,
        uploadWorkspace: true,
        signal: ctx?.signal,
      })
      const activeBinding = this.appendBinding({
        ...binding,
        state: "active",
        sandboxId,
        guestHome: initialized.guestHome,
      })
      const active = {
        sandbox,
        binding: activeBinding,
        guestHome: initialized.guestHome,
      }
      this.binding = activeBinding
      this.active = active
      this.initializationError = undefined
      setStatus(ctx, `Superserve: ${shortId(sandbox.id)} (${GUEST_WORKSPACE})`)
      if (initialized.syncedFiles > 0) {
        notify(
          ctx,
          `Superserve sandbox ready. Uploaded ${initialized.syncedFiles} tracked files (${formatBytes(initialized.syncedBytes)}).`,
          "info",
        )
      }
      return active
    } catch (error) {
      if (sandbox) {
        try {
          await sandbox.kill()
        } catch {
          // The original setup failure is more useful than cleanup failure.
        }
        this.binding = this.appendBindingBestEffort({
          ...binding,
          state: "missing",
          sandboxId,
        })
      }
      throw error
    }
  }

  private async attach(
    sandboxId: string,
    ctx?: ExtensionContext,
  ): Promise<ActiveSandbox> {
    const validatedSandboxId = requireSandboxId(
      sandboxId,
      "Superserve sandbox ID",
    )
    if (ctx) this.currentCwd = ctx.cwd
    const timestamp = this.now().toISOString()
    const binding = this.appendBinding({
      version: SESSION_ENTRY_VERSION,
      ownerSessionId:
        ctx?.sessionManager.getSessionId() ??
        this.binding?.ownerSessionId ??
        this.randomId(),
      clientId: this.randomId(),
      bindingId: this.randomId(),
      state: "attaching",
      managed: false,
      sandboxId: validatedSandboxId,
      workspacePath: GUEST_WORKSPACE,
      sync: "none",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    this.binding = binding
    return this.connectBinding(binding, ctx, false)
  }

  private async connectBinding(
    binding: SandboxBinding,
    ctx: ExtensionContext | undefined,
    replaceMissing: boolean,
  ): Promise<ActiveSandbox> {
    if (!binding.sandboxId) {
      throw new Error("Persisted Superserve binding has no sandbox ID")
    }
    const sandboxId = requireSandboxId(
      binding.sandboxId,
      "persisted Superserve binding",
    )
    const localCwd = ctx?.cwd ?? this.currentCwd
    this.currentCwd = localCwd
    setStatus(ctx, `Superserve: connecting ${shortId(sandboxId)}`)

    let sandbox: SandboxHandle
    try {
      sandbox = await this.connectWithRetry(sandboxId, ctx?.signal)
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
      if (binding.state === "attaching") throw error
      this.binding = this.appendBinding({ ...binding, state: "missing" })
      if (replaceMissing) {
        return this.provisionNew(optionsFromBinding(binding), ctx)
      }
      throw errorWithCause(
        "Superserve sandbox no longer exists. The operation was not run on the host. Run /superserve new.",
        error,
      )
    }

    const initialized = await this.bootstrap(sandbox, {
      localCwd,
      sync: "none",
      uploadWorkspace: false,
      signal: ctx?.signal,
    })
    const activeBinding = this.appendBinding({
      ...binding,
      state: "active",
      sandboxId: sandbox.id,
      guestHome: initialized.guestHome,
    })
    const active = {
      sandbox,
      binding: activeBinding,
      guestHome: initialized.guestHome,
    }
    this.binding = activeBinding
    this.active = active
    this.initializationError = undefined
    setStatus(ctx, `Superserve: ${shortId(sandbox.id)} (${GUEST_WORKSPACE})`)
    return active
  }

  private async reconcileProvisioning(
    binding: SandboxBinding,
    ctx?: ExtensionContext,
  ): Promise<ActiveSandbox> {
    if (ctx) this.currentCwd = ctx.cwd
    const metadata = metadataFor(binding)
    const listed = await this.provider.list({
      metadata,
      signal: ctx?.signal,
    })
    const candidates = listed.filter((candidate) =>
      Object.entries(metadata).every(
        ([key, value]) => candidate.metadata[key] === value,
      ),
    )
    for (const candidate of candidates) {
      requireSandboxId(candidate.id, "Superserve list response")
    }
    if (candidates.length === 0) {
      return this.provision(binding, optionsFromBinding(binding), ctx)
    }

    const selected = candidates.reduce((earliest, candidate) =>
      candidate.createdAt.getTime() < earliest.createdAt.getTime() ||
      (candidate.createdAt.getTime() === earliest.createdAt.getTime() &&
        candidate.id.localeCompare(earliest.id) < 0)
        ? candidate
        : earliest,
    )
    for (const duplicate of candidates.filter(
      (candidate) => candidate.id !== selected.id,
    )) {
      await this.provider.killById(duplicate.id, { signal: ctx?.signal })
    }

    const recovered = this.appendBinding({
      ...binding,
      sandboxId: selected.id,
      state: "active",
    })
    return this.connectBinding(recovered, ctx, true)
  }

  private async connectWithRetry(
    sandboxId: string,
    signal?: AbortSignal,
  ): Promise<SandboxHandle> {
    const validatedSandboxId = requireSandboxId(
      sandboxId,
      "Superserve sandbox ID",
    )
    const delays = [50, 150, 450]
    for (let attempt = 0; ; attempt += 1) {
      try {
        const sandbox = await this.provider.connect(validatedSandboxId, {
          signal,
        })
        const returnedSandboxId = requireSandboxId(
          sandbox.id,
          "Superserve connect response",
        )
        if (!sameSandboxIdentity(returnedSandboxId, validatedSandboxId)) {
          throw new Error(
            `Superserve connect response returned sandbox ${returnedSandboxId}, expected ${validatedSandboxId}`,
          )
        }
        return sandbox
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt >= delays.length) {
          throw error
        }
        await this.sleep(delays[attempt] ?? 450)
      }
    }
  }

  private appendBinding(binding: SandboxBinding): SandboxBinding {
    const next = { ...binding, updatedAt: this.now().toISOString() }
    this.pi.appendEntry(SESSION_ENTRY_TYPE, next)
    return next
  }

  private appendBindingBestEffort(binding: SandboxBinding): SandboxBinding {
    try {
      return this.appendBinding(binding)
    } catch {
      return binding
    }
  }

  private readRuntimeOptions(): SandboxRuntimeOptions {
    const template =
      this.getStringFlag("superserve-template") ?? DEFAULT_TEMPLATE
    const timeoutSeconds = parseIntegerFlag(
      this.pi.getFlag("superserve-timeout"),
      "--superserve-timeout",
      DEFAULT_TIMEOUT_SECONDS,
      1,
    )
    const autoDeleteFlag = this.pi.getFlag("superserve-auto-delete")
    const autoDeleteSeconds =
      typeof autoDeleteFlag === "string" && autoDeleteFlag.trim() === "none"
        ? undefined
        : parseIntegerFlag(
            autoDeleteFlag,
            "--superserve-auto-delete",
            DEFAULT_AUTO_DELETE_SECONDS,
            0,
          )
    const syncFlag = this.getStringFlag("superserve-sync") ?? "tracked"
    if (syncFlag !== "tracked" && syncFlag !== "none") {
      throw new Error("--superserve-sync must be tracked or none")
    }
    return { template, timeoutSeconds, autoDeleteSeconds, sync: syncFlag }
  }

  private getStringFlag(name: string): string | undefined {
    const value = this.pi.getFlag(name)
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed || undefined
  }

  private unavailableError(): Error {
    const detail = this.initializationError
      ? ` ${formatError(this.initializationError)}`
      : ""
    return new Error(
      `Superserve sandbox is unavailable; the operation was not run on the host.${detail}`,
    )
  }
}

interface PersistedBindings {
  restored?: SandboxBinding
  inherited?: SandboxBinding
  error?: Error
}

function findPersistedBindings(
  ctx: ExtensionContext,
  ownerSessionId: string,
): PersistedBindings {
  const branch = ctx.sessionManager.getBranch()
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (entry?.type !== "custom" || entry.customType !== SESSION_ENTRY_TYPE) {
      continue
    }
    const binding = parseBinding(entry.data)
    if (!binding) {
      return {
        error: new Error(
          "Persisted Superserve binding is invalid; sandbox tools remain fail-closed. Run /superserve new to replace it.",
        ),
      }
    }
    return binding.ownerSessionId === ownerSessionId
      ? { restored: binding }
      : { inherited: binding }
  }
  return {}
}

export function parseBinding(value: unknown): SandboxBinding | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const binding = value as Record<string, unknown>
  if (
    binding.version !== SESSION_ENTRY_VERSION ||
    typeof binding.ownerSessionId !== "string" ||
    typeof binding.clientId !== "string" ||
    typeof binding.bindingId !== "string" ||
    !isBindingState(binding.state) ||
    typeof binding.managed !== "boolean" ||
    binding.workspacePath !== GUEST_WORKSPACE ||
    (binding.sandboxId !== undefined &&
      (typeof binding.sandboxId !== "string" ||
        !isSandboxId(binding.sandboxId))) ||
    (binding.guestHome !== undefined &&
      typeof binding.guestHome !== "string") ||
    (binding.template !== undefined && typeof binding.template !== "string") ||
    (binding.timeoutSeconds !== undefined &&
      typeof binding.timeoutSeconds !== "number") ||
    (binding.autoDeleteSeconds !== undefined &&
      typeof binding.autoDeleteSeconds !== "number") ||
    (binding.sync !== "tracked" && binding.sync !== "none") ||
    typeof binding.createdAt !== "string" ||
    typeof binding.updatedAt !== "string"
  ) {
    return undefined
  }
  return binding as unknown as SandboxBinding
}

function isBindingState(value: unknown): value is SandboxBinding["state"] {
  return (
    value === "provisioning" ||
    value === "attaching" ||
    value === "active" ||
    value === "paused" ||
    value === "missing" ||
    value === "destroyed"
  )
}

const SANDBOX_ID_RE =
  /^(?:sb-[a-z0-9]{1,17}-)?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/

function isSandboxId(value: string): boolean {
  return SANDBOX_ID_RE.test(value)
}

function requireSandboxId(value: unknown, source: string): string {
  if (typeof value !== "string" || !isSandboxId(value)) {
    throw new Error(
      `${source} must be a valid Superserve sandbox ID (UUID or sb-<region>-<UUID>)`,
    )
  }
  return value
}

function sameSandboxIdentity(left: string, right: string): boolean {
  return sandboxUuid(left) === sandboxUuid(right)
}

function sandboxUuid(sandboxId: string): string {
  return sandboxId.slice(-36).toLowerCase()
}

function metadataFor(binding: SandboxBinding): Record<string, string> {
  return {
    "created-by": CREATED_BY,
    "pi-client-id": binding.clientId,
    "pi-session-id": binding.ownerSessionId,
    "pi-binding-id": binding.bindingId,
    "entry-version": String(SESSION_ENTRY_VERSION),
  }
}

function optionsFromBinding(binding: SandboxBinding): SandboxRuntimeOptions {
  return {
    template: binding.template ?? DEFAULT_TEMPLATE,
    timeoutSeconds: binding.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    autoDeleteSeconds: binding.autoDeleteSeconds,
    sync: binding.sync,
  }
}

function sandboxName(localCwd: string, bindingId: string): string {
  const project = path
    .basename(localCwd)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
  return `pi-${project || "workspace"}-${bindingId.slice(0, 8)}`
}

function resolveDownloadPath(localCwd: string, output: string): string {
  const root = path.resolve(localCwd)
  const resolved = path.resolve(root, output)
  const relative = path.relative(root, resolved)
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Workspace download path must stay inside the current cwd")
  }
  return resolved
}

interface DownloadTarget {
  rootPath: string
  parentPath: string
  filePath: string
}

async function createDownloadParent(
  localCwd: string,
  outputPath: string,
): Promise<DownloadTarget> {
  const lexicalRoot = path.resolve(localCwd)
  const relativeParent = path.relative(lexicalRoot, path.dirname(outputPath))
  if (isOutsidePath(relativeParent)) {
    throw new Error("Workspace download path must stay inside the current cwd")
  }

  const rootPath = await realpath(lexicalRoot)
  let parentPath = rootPath
  for (const segment of relativeParent.split(path.sep)) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      throw new Error(
        "Workspace download path must stay inside the current cwd",
      )
    }
    const nextPath = path.join(parentPath, segment)
    await ensureDownloadDirectory(nextPath)
    const resolved = await realpath(nextPath)
    if (!isPathWithin(rootPath, resolved)) {
      throw new Error(
        "Workspace download path must stay inside the current cwd",
      )
    }
    parentPath = resolved
  }

  return {
    rootPath,
    parentPath,
    filePath: path.join(parentPath, path.basename(outputPath)),
  }
}

async function ensureDownloadDirectory(directoryPath: string): Promise<void> {
  try {
    const info = await lstat(directoryPath)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(
        "Workspace download parent must not contain symlinks or non-directories",
      )
    }
    return
  } catch (error) {
    if (!hasFileSystemCode(error, "ENOENT")) throw error
  }

  try {
    await mkdir(directoryPath, { mode: 0o700 })
  } catch (error) {
    if (!hasFileSystemCode(error, "EEXIST")) throw error
  }

  const info = await lstat(directoryPath)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(
      "Workspace download parent must not contain symlinks or non-directories",
    )
  }
}

async function revalidateDownloadParent(target: DownloadTarget): Promise<void> {
  const info = await lstat(target.parentPath)
  const resolved = await realpath(target.parentPath)
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    resolved !== target.parentPath ||
    !isPathWithin(target.rootPath, resolved) ||
    path.dirname(target.filePath) !== target.parentPath
  ) {
    throw new Error(
      "Workspace download parent changed or escaped the current cwd",
    )
  }
}

function hasFileSystemCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  )
}

function isOutsidePath(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  )
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return !isOutsidePath(relative)
}

function parseIntegerFlag(
  value: boolean | string | undefined,
  name: string,
  fallback: number,
  minimum: number,
): number {
  if (value === undefined) return fallback
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}`,
    )
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}`,
    )
  }
  return number
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message)
  ;(error as Error & { cause?: unknown }).cause = cause
  return error
}

function setStatus(
  ctx: ExtensionContext | undefined,
  message: string,
  color: "accent" | "warning" = "accent",
): void {
  if (!ctx?.hasUI) return
  try {
    ctx.ui.setStatus("superserve", ctx.ui.theme.fg(color, message))
  } catch {
    // Status is optional in non-TUI frontends.
  }
}

function clearStatus(ctx: ExtensionContext | undefined): void {
  if (!ctx?.hasUI) return
  try {
    ctx.ui.setStatus("superserve", undefined)
  } catch {
    // Status is optional in non-TUI frontends.
  }
}

function notify(
  ctx: ExtensionContext | undefined,
  message: string,
  level: "info" | "warning" | "error",
): void {
  if (!ctx?.hasUI) return
  try {
    ctx.ui.notify(message, level)
  } catch {
    // Notifications are optional in non-TUI frontends.
  }
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`
}
