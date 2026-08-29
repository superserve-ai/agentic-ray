import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import {
  AuthenticationError,
  NotFoundError,
  type SandboxInfo,
} from "@superserve/sdk"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CREATED_BY,
  DEFAULT_AUTO_DELETE_SECONDS,
  DEFAULT_TEMPLATE,
  DEFAULT_TIMEOUT_SECONDS,
  GUEST_WORKSPACE,
  ROUTED_TOOL_NAMES,
  SESSION_ENTRY_TYPE,
  SESSION_ENTRY_VERSION,
} from "../src/constants.js"
import { parseBinding, SandboxLifecycle } from "../src/lifecycle.js"
import type {
  SandboxBinding,
  SandboxBootstrap,
  SandboxHandle,
  SandboxProvider,
} from "../src/types.js"

const LOCAL_CWD = "/repo/project"
const OTHER_CWD = "/repo/other-project"
const NOW = new Date("2026-07-17T00:00:00.000Z")
const SANDBOX_EXISTING_ID = sandboxId(1)
const SANDBOX_CREATED_ID = sandboxId(2)
const SANDBOX_FORK_ID = sandboxId(3)
const SANDBOX_REPLACEMENT_ID = sandboxId(4)
const SANDBOX_EPHEMERAL_ID = sandboxId(5)

interface CustomEntry {
  customType: string
  data: unknown
}

interface HarnessOptions {
  binding?: SandboxBinding
  cwd?: string
  flags?: Record<string, boolean | string | undefined>
  persistent?: boolean
  sessionId?: string
}

function makeBinding(overrides: Partial<SandboxBinding> = {}): SandboxBinding {
  return {
    version: SESSION_ENTRY_VERSION,
    ownerSessionId: "session-1",
    clientId: "client-existing",
    bindingId: "binding-existing",
    state: "paused",
    managed: true,
    sandboxId: SANDBOX_EXISTING_ID,
    workspacePath: GUEST_WORKSPACE,
    guestHome: "/root",
    template: DEFAULT_TEMPLATE,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    autoDeleteSeconds: DEFAULT_AUTO_DELETE_SECONDS,
    sync: "tracked",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  }
}

function makeHarness(options: HarnessOptions = {}) {
  const sessionId = options.sessionId ?? "session-1"
  const flags = { ...options.flags }
  const appended: CustomEntry[] = []
  const branch: Array<Record<string, unknown>> = []
  if (options.binding) {
    branch.push({
      type: "custom",
      customType: SESSION_ENTRY_TYPE,
      data: options.binding,
    })
  }

  const getFlag = vi.fn((name: string) => flags[name])
  const setActiveTools = vi.fn((_toolNames: string[]) => undefined)
  const appendEntry = vi.fn((customType: string, data?: unknown) => {
    appended.push({ customType, data })
    branch.push({ type: "custom", customType, data })
  })
  const pi = {
    appendEntry,
    getFlag,
    setActiveTools,
  } as unknown as ExtensionAPI
  const ctx = {
    cwd: options.cwd ?? LOCAL_CWD,
    hasUI: false,
    sessionManager: {
      getBranch: () => branch,
      getSessionFile: () =>
        options.persistent === false ? undefined : "/tmp/session.jsonl",
      getSessionId: () => sessionId,
    },
    signal: undefined,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      theme: { fg: (_color: string, message: string) => message },
    },
  } as unknown as ExtensionContext

  return {
    appendEntry,
    appended,
    branch,
    ctx,
    flags,
    getFlag,
    pi,
    setActiveTools,
  }
}

function makeSandboxInfo(
  id: string,
  createdAt = NOW,
  metadata: Record<string, string> = {},
): SandboxInfo {
  return {
    id,
    name: `sandbox-${id}`,
    status: "active",
    vcpuCount: 1,
    memoryMib: 512,
    createdAt,
    metadata,
  }
}

function makeSandbox(id: string) {
  const info = makeSandboxInfo(id)
  const pause = vi.fn(async () => undefined)
  const resume = vi.fn(async () => undefined)
  const kill = vi.fn(async () => undefined)
  const getInfo = vi.fn(async () => info)
  const handle: SandboxHandle = {
    id,
    name: info.name,
    status: info.status,
    metadata: info.metadata,
    commands: {} as SandboxHandle["commands"],
    files: {} as SandboxHandle["files"],
    getInfo,
    pause,
    resume,
    kill,
  }
  return { getInfo, handle, kill, pause, resume }
}

function makeProvider(
  createdSandbox = makeSandbox(SANDBOX_CREATED_ID).handle,
  connectedSandbox = makeSandbox(SANDBOX_EXISTING_ID).handle,
) {
  const create = vi.fn<SandboxProvider["create"]>(async () => createdSandbox)
  const connect = vi.fn<SandboxProvider["connect"]>(
    async () => connectedSandbox,
  )
  const list = vi.fn<SandboxProvider["list"]>(async () => [])
  const killById = vi.fn<SandboxProvider["killById"]>(async () => undefined)
  const provider = { connect, create, killById, list } satisfies SandboxProvider
  return { connect, create, killById, list, provider }
}

function makeBootstrap() {
  return vi.fn<SandboxBootstrap>(async () => ({
    guestHome: "/root",
    syncedFiles: 0,
    syncedBytes: 0,
  }))
}

function makeLifecycle(
  pi: ExtensionAPI,
  provider: SandboxProvider,
  bootstrap: SandboxBootstrap,
  randomIds: string[] = ["client-new", "binding-new"],
): SandboxLifecycle {
  const ids = [...randomIds]
  return new SandboxLifecycle(pi, LOCAL_CWD, {
    provider,
    bootstrap,
    now: () => NOW,
    randomId: () => {
      const id = ids.shift()
      if (!id) throw new Error("Test exhausted deterministic IDs")
      return id
    },
    sleep: async () => undefined,
  })
}

function latestBinding(appended: CustomEntry[]): SandboxBinding {
  const entry = appended.at(-1)
  const binding = parseBinding(entry?.data)
  if (!binding) throw new Error("Expected a persisted sandbox binding")
  return binding
}

function appendedStates(appended: CustomEntry[]): string[] {
  return appended.map((entry) => {
    const binding = parseBinding(entry.data)
    if (!binding) throw new Error("Expected a persisted sandbox binding")
    return binding.state
  })
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  )
})

function sandboxId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
}

describe("SandboxLifecycle", () => {
  it("stays dormant without an opt-in flag or persisted binding", async () => {
    const harness = makeHarness()
    const provider = makeProvider()
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

    await lifecycle.start("startup", harness.ctx)

    expect(lifecycle.isEnabled()).toBe(false)
    expect(lifecycle.getActive()).toBeUndefined()
    expect(provider.create).not.toHaveBeenCalled()
    expect(provider.connect).not.toHaveBeenCalled()
    expect(provider.list).not.toHaveBeenCalled()
    expect(bootstrap).not.toHaveBeenCalled()
    expect(harness.setActiveTools).not.toHaveBeenCalled()
    expect(harness.appendEntry).not.toHaveBeenCalled()
    await expect(lifecycle.requireSandbox(harness.ctx)).rejects.toThrow(
      "Superserve sandbox mode is not enabled",
    )
  })

  it.each([
    ["restored", "session-1"],
    ["foreign", "session-parent"],
  ])(
    "keeps a fresh process fail-closed for a %s binding without an explicit flag",
    async (_label, bindingOwnerSessionId) => {
      const binding = makeBinding({ ownerSessionId: bindingOwnerSessionId })
      const harness = makeHarness({ binding })
      const provider = makeProvider()
      const bootstrap = makeBootstrap()
      const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

      await lifecycle.start("resume", harness.ctx)

      expect(lifecycle.isEnabled()).toBe(true)
      expect(lifecycle.getActive()).toBeUndefined()
      expect(harness.setActiveTools).toHaveBeenCalledWith([
        ...ROUTED_TOOL_NAMES,
      ])
      expect(provider.connect).not.toHaveBeenCalled()
      expect(provider.create).not.toHaveBeenCalled()
      expect(bootstrap).not.toHaveBeenCalled()
      await expect(lifecycle.requireSandbox(harness.ctx)).rejects.toThrow(
        "Restart Pi with --superserve",
      )
    },
  )

  it("carries explicit intent across an in-process reload and refreshes cwd", async () => {
    const harness = makeHarness({ flags: { superserve: true } })
    const sandbox = makeSandbox(SANDBOX_CREATED_ID)
    const provider = makeProvider(sandbox.handle, sandbox.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

    await lifecycle.start("startup", harness.ctx)
    await lifecycle.shutdown("reload", harness.ctx)
    harness.flags.superserve = undefined
    ;(harness.ctx as ExtensionContext & { cwd: string }).cwd = OTHER_CWD

    await lifecycle.start("reload", harness.ctx)

    expect(provider.create).toHaveBeenCalledOnce()
    expect(provider.connect).toHaveBeenCalledOnce()
    expect(provider.connect).toHaveBeenCalledWith(SANDBOX_CREATED_ID, {
      signal: undefined,
    })
    expect(bootstrap).toHaveBeenNthCalledWith(2, sandbox.handle, {
      localCwd: OTHER_CWD,
      sync: "none",
      uploadWorkspace: false,
      signal: undefined,
    })
    expect(lifecycle.getActive()?.sandbox.id).toBe(SANDBOX_CREATED_ID)
  })

  it("uses command context cwd when creating a new sandbox", async () => {
    const harness = makeHarness({ cwd: OTHER_CWD })
    const created = makeSandbox(SANDBOX_CREATED_ID)
    const provider = makeProvider(created.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

    await lifecycle.createNew(harness.ctx)

    expect(provider.create.mock.calls[0]?.[0].name).toMatch(
      /^pi-other-project-/,
    )
    expect(bootstrap).toHaveBeenCalledWith(created.handle, {
      localCwd: OTHER_CWD,
      sync: "tracked",
      uploadWorkspace: true,
      signal: undefined,
    })
  })

  it("creates and persists a managed sandbox with exact non-secret metadata", async () => {
    const secret = "ss_live_must_not_be_persisted"
    vi.stubEnv("SUPERSERVE_API_KEY", secret)
    const harness = makeHarness({ flags: { superserve: true } })
    const created = makeSandbox(SANDBOX_CREATED_ID)
    const provider = makeProvider(created.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap, [
      "client-new",
      "binding-new",
    ])

    await lifecycle.start("startup", harness.ctx)

    expect(provider.create).toHaveBeenCalledTimes(1)
    const createOptions = provider.create.mock.calls[0]?.[0]
    expect(createOptions).toMatchObject({
      fromTemplate: DEFAULT_TEMPLATE,
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
      autoDeleteSeconds: DEFAULT_AUTO_DELETE_SECONDS,
      metadata: {
        "created-by": CREATED_BY,
        "pi-client-id": "client-new",
        "pi-session-id": "session-1",
        "pi-binding-id": "binding-new",
        "entry-version": String(SESSION_ENTRY_VERSION),
      },
    })
    expect(createOptions?.name).toMatch(/^pi-project-/)
    expect(createOptions).not.toHaveProperty("apiKey")
    expect(createOptions).not.toHaveProperty("baseUrl")
    expect(createOptions).not.toHaveProperty("envVars")
    expect(createOptions).not.toHaveProperty("secrets")
    expect(bootstrap).toHaveBeenCalledWith(created.handle, {
      localCwd: LOCAL_CWD,
      sync: "tracked",
      uploadWorkspace: true,
      signal: undefined,
    })
    expect(appendedStates(harness.appended)).toEqual(["provisioning", "active"])
    expect(latestBinding(harness.appended)).toMatchObject({
      ownerSessionId: "session-1",
      clientId: "client-new",
      bindingId: "binding-new",
      sandboxId: SANDBOX_CREATED_ID,
      state: "active",
      managed: true,
      workspacePath: GUEST_WORKSPACE,
      guestHome: "/root",
    })
    expect(
      JSON.stringify({ createOptions, entries: harness.appended }),
    ).not.toContain(secret)
    expect(lifecycle.getActive()?.sandbox.id).toBe(SANDBOX_CREATED_ID)
    expect(harness.setActiveTools).toHaveBeenCalledWith([...ROUTED_TOOL_NAMES])
  })

  it("resumes a persisted sandbox using the current cross-project cwd", async () => {
    const binding = makeBinding({ state: "paused" })
    const harness = makeHarness({
      binding,
      cwd: OTHER_CWD,
      flags: { superserve: true },
    })
    const connected = makeSandbox(SANDBOX_EXISTING_ID)
    const provider = makeProvider(undefined, connected.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

    await lifecycle.start("resume", harness.ctx)

    expect(provider.connect).toHaveBeenCalledOnce()
    expect(provider.connect).toHaveBeenCalledWith(SANDBOX_EXISTING_ID, {
      signal: undefined,
    })
    expect(provider.create).not.toHaveBeenCalled()
    expect(provider.list).not.toHaveBeenCalled()
    expect(bootstrap).toHaveBeenCalledWith(connected.handle, {
      localCwd: OTHER_CWD,
      sync: "none",
      uploadWorkspace: false,
      signal: undefined,
    })
    expect(latestBinding(harness.appended).state).toBe("active")
    expect(lifecycle.getActive()?.sandbox.id).toBe(SANDBOX_EXISTING_ID)
  })

  it("persists a command-selected target before connecting and only retries that target", async () => {
    const targetId = sandboxId(20)
    const binding = makeBinding({ state: "active" })
    const harness = makeHarness({ binding, flags: { superserve: true } })
    const connected = makeSandbox(SANDBOX_EXISTING_ID)
    const provider = makeProvider(undefined, connected.handle)
    const failure = new Error("target control plane unavailable")
    provider.connect
      .mockResolvedValueOnce(connected.handle)
      .mockRejectedValue(failure)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)
    await lifecycle.start("startup", harness.ctx)

    await expect(lifecycle.connect(targetId, harness.ctx)).rejects.toThrow(
      failure.message,
    )

    expect(connected.pause).toHaveBeenCalledOnce()
    expect(latestBinding(harness.appended)).toMatchObject({
      state: "attaching",
      managed: false,
      sandboxId: targetId,
    })
    expect(lifecycle.getActive()).toBeUndefined()
    await expect(lifecycle.requireSandbox(harness.ctx)).rejects.toThrow(
      failure.message,
    )

    const replacementLifecycle = makeLifecycle(
      harness.pi,
      provider.provider,
      bootstrap,
    )
    await replacementLifecycle.start("startup", harness.ctx)

    expect(provider.connect.mock.calls.map(([id]) => id)).toEqual([
      SANDBOX_EXISTING_ID,
      targetId,
      targetId,
      targetId,
    ])
    expect(replacementLifecycle.getBinding()).toMatchObject({
      state: "attaching",
      sandboxId: targetId,
    })
  })

  it("persists a --superserve-sandbox target before a failed startup attach", async () => {
    const targetId = sandboxId(21)
    const binding = makeBinding({ state: "paused" })
    const harness = makeHarness({
      binding,
      flags: { "superserve-sandbox": targetId },
    })
    const provider = makeProvider()
    const failure = new NotFoundError("target unavailable")
    provider.connect.mockRejectedValue(failure)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

    await lifecycle.start("startup", harness.ctx)

    expect(latestBinding(harness.appended)).toMatchObject({
      state: "attaching",
      managed: false,
      sandboxId: targetId,
    })
    expect(provider.connect).toHaveBeenCalledWith(targetId, {
      signal: undefined,
    })
    expect(provider.connect).not.toHaveBeenCalledWith(SANDBOX_EXISTING_ID, {
      signal: undefined,
    })
    await expect(lifecycle.requireSandbox(harness.ctx)).rejects.toThrow(
      failure.message,
    )
    expect(provider.connect.mock.calls.map(([id]) => id)).toEqual([
      targetId,
      targetId,
    ])
  })

  it("does not retain a restored sandbox when an explicit target is invalid", async () => {
    const invalidId = "../../host/path"
    const binding = makeBinding({ state: "paused" })
    const harness = makeHarness({
      binding,
      flags: { "superserve-sandbox": invalidId },
    })
    const provider = makeProvider()
    const lifecycle = makeLifecycle(
      harness.pi,
      provider.provider,
      makeBootstrap(),
    )

    await lifecycle.start("startup", harness.ctx)

    expect(lifecycle.getBinding()).toBeUndefined()
    expect(provider.connect).not.toHaveBeenCalled()
    await expect(lifecycle.requireSandbox(harness.ctx)).rejects.toThrow(
      "--superserve-sandbox must be a valid Superserve sandbox ID",
    )
  })

  it("creates a distinct sandbox for a fork", async () => {
    const oldBinding = makeBinding({ ownerSessionId: "session-parent" })
    const harness = makeHarness({
      binding: oldBinding,
      flags: { superserve: true },
      sessionId: "session-fork",
    })
    const created = makeSandbox(SANDBOX_FORK_ID)
    const provider = makeProvider(created.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap, [
      "client-fork",
      "binding-fork",
    ])

    await lifecycle.start("fork", harness.ctx)

    expect(provider.connect).not.toHaveBeenCalled()
    expect(provider.create).toHaveBeenCalledOnce()
    expect(provider.create.mock.calls[0]?.[0].metadata).toEqual({
      "created-by": CREATED_BY,
      "pi-client-id": "client-fork",
      "pi-session-id": "session-fork",
      "pi-binding-id": "binding-fork",
      "entry-version": String(SESSION_ENTRY_VERSION),
    })
    expect(latestBinding(harness.appended)).toMatchObject({
      ownerSessionId: "session-fork",
      sandboxId: SANDBOX_FORK_ID,
      bindingId: "binding-fork",
    })
    expect(latestBinding(harness.appended).sandboxId).not.toBe(
      oldBinding.sandboxId,
    )
  })

  it("replaces a persisted sandbox only when connect returns 404", async () => {
    const binding = makeBinding({ state: "active" })
    const harness = makeHarness({ binding, flags: { superserve: true } })
    const replacement = makeSandbox(SANDBOX_REPLACEMENT_ID)
    const provider = makeProvider(replacement.handle)
    provider.connect.mockRejectedValue(new NotFoundError("sandbox gone"))
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap, [
      "client-replacement",
      "binding-replacement",
    ])

    await lifecycle.start("startup", harness.ctx)

    expect(provider.connect).toHaveBeenCalledOnce()
    expect(provider.create).toHaveBeenCalledOnce()
    expect(appendedStates(harness.appended)).toEqual([
      "missing",
      "provisioning",
      "active",
    ])
    expect(latestBinding(harness.appended)).toMatchObject({
      sandboxId: SANDBOX_REPLACEMENT_ID,
      state: "active",
    })
    expect(lifecycle.getActive()?.sandbox.id).toBe(SANDBOX_REPLACEMENT_ID)
  })

  it.each([
    ["transient", new Error("temporary control-plane failure")],
    ["authentication", new AuthenticationError("bad API key")],
  ])(
    "fails closed on a %s connect error without creating a duplicate",
    async (_label, error) => {
      const binding = makeBinding({ state: "paused" })
      const harness = makeHarness({ binding, flags: { superserve: true } })
      const provider = makeProvider()
      provider.connect.mockRejectedValue(error)
      const bootstrap = makeBootstrap()
      const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

      await lifecycle.start("startup", harness.ctx)

      expect(lifecycle.isEnabled()).toBe(true)
      expect(lifecycle.getActive()).toBeUndefined()
      expect(lifecycle.getBinding()).toEqual(binding)
      expect(provider.create).not.toHaveBeenCalled()
      expect(provider.list).not.toHaveBeenCalled()
      expect(bootstrap).not.toHaveBeenCalled()
      await expect(lifecycle.requireSandbox(harness.ctx)).rejects.toThrow(
        error.message,
      )
      expect(provider.create).not.toHaveBeenCalled()
    },
  )

  it("recovers a provisioning binding and removes duplicate sandboxes using exact metadata", async () => {
    const binding = makeBinding({
      state: "provisioning",
      sandboxId: undefined,
      guestHome: undefined,
    })
    const harness = makeHarness({ binding, flags: { superserve: true } })
    const selectedId = sandboxId(10)
    const selected = makeSandbox(selectedId)
    const provider = makeProvider(undefined, selected.handle)
    const metadata = {
      "created-by": CREATED_BY,
      "pi-client-id": binding.clientId,
      "pi-session-id": binding.ownerSessionId,
      "pi-binding-id": binding.bindingId,
      "entry-version": String(SESSION_ENTRY_VERSION),
    }
    provider.list.mockResolvedValue([
      makeSandboxInfo(
        sandboxId(90),
        new Date("2026-07-16T01:00:00.000Z"),
        metadata,
      ),
      makeSandboxInfo(
        selectedId,
        new Date("2026-07-16T01:00:00.000Z"),
        metadata,
      ),
      makeSandboxInfo(
        sandboxId(50),
        new Date("2026-07-16T02:00:00.000Z"),
        metadata,
      ),
    ])
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

    await lifecycle.start("startup", harness.ctx)

    expect(provider.list).toHaveBeenCalledOnce()
    expect(provider.list).toHaveBeenCalledWith({
      metadata,
      signal: undefined,
    })
    expect(provider.killById).toHaveBeenCalledTimes(2)
    expect(provider.killById).toHaveBeenNthCalledWith(1, sandboxId(90), {
      signal: undefined,
    })
    expect(provider.killById).toHaveBeenNthCalledWith(2, sandboxId(50), {
      signal: undefined,
    })
    expect(provider.connect).toHaveBeenCalledWith(selectedId, {
      signal: undefined,
    })
    expect(provider.create).not.toHaveBeenCalled()
    expect(bootstrap).toHaveBeenCalledWith(selected.handle, {
      localCwd: LOCAL_CWD,
      sync: "none",
      uploadWorkspace: false,
      signal: undefined,
    })
    expect(latestBinding(harness.appended)).toMatchObject({
      sandboxId: selectedId,
      state: "active",
    })
  })

  it("rejects invalid sandbox IDs at flag, command, and session boundaries", async () => {
    const invalidId = "../../host/path"
    const invalidBinding = makeBinding({ sandboxId: invalidId })
    expect(parseBinding(invalidBinding)).toBeUndefined()

    const persistedHarness = makeHarness({
      binding: invalidBinding,
      flags: { superserve: true },
    })
    const persistedProvider = makeProvider()
    const persistedBootstrap = makeBootstrap()
    const persistedLifecycle = makeLifecycle(
      persistedHarness.pi,
      persistedProvider.provider,
      persistedBootstrap,
    )
    await persistedLifecycle.start("resume", persistedHarness.ctx)

    expect(persistedLifecycle.isEnabled()).toBe(true)
    expect(persistedProvider.connect).not.toHaveBeenCalled()
    expect(persistedProvider.create).not.toHaveBeenCalled()
    await expect(
      persistedLifecycle.requireSandbox(persistedHarness.ctx),
    ).rejects.toThrow("Persisted Superserve binding is invalid")

    const flagHarness = makeHarness({
      flags: { "superserve-sandbox": invalidId },
    })
    const flagProvider = makeProvider()
    const flagLifecycle = makeLifecycle(
      flagHarness.pi,
      flagProvider.provider,
      makeBootstrap(),
    )
    await flagLifecycle.start("startup", flagHarness.ctx)
    expect(flagProvider.connect).not.toHaveBeenCalled()
    await expect(flagLifecycle.requireSandbox(flagHarness.ctx)).rejects.toThrow(
      "--superserve-sandbox must be a valid Superserve sandbox ID",
    )

    const commandHarness = makeHarness()
    const commandProvider = makeProvider()
    const commandLifecycle = makeLifecycle(
      commandHarness.pi,
      commandProvider.provider,
      makeBootstrap(),
    )
    await expect(
      commandLifecycle.connect(invalidId, commandHarness.ctx),
    ).rejects.toThrow(
      "/superserve connect must be a valid Superserve sandbox ID",
    )
    expect(commandLifecycle.isEnabled()).toBe(true)
    expect(commandProvider.connect).not.toHaveBeenCalled()
  })

  it("accepts equivalent uppercase, bare, and region-prefixed sandbox identities", async () => {
    const uppercaseBareId = "ABCDEF12-3456-4ABC-8DEF-ABCDEF123456"
    const providerId = "sb-usw-abcdef12-3456-4abc-8def-abcdef123456"
    const harness = makeHarness()
    const connected = makeSandbox(providerId)
    const provider = makeProvider(undefined, connected.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

    await lifecycle.connect(uppercaseBareId, harness.ctx)

    expect(provider.connect).toHaveBeenCalledWith(uppercaseBareId, {
      signal: undefined,
    })
    expect(lifecycle.getBinding()).toMatchObject({
      sandboxId: providerId,
      state: "active",
    })
    expect(appendedStates(harness.appended)).toEqual(["attaching", "active"])
  })

  it("treats bare and tagged forms as the same explicit restored sandbox", async () => {
    const bareId = "ABCDEF12-3456-4ABC-8DEF-ABCDEF123456"
    const providerId = "sb-use-abcdef12-3456-4abc-8def-abcdef123456"
    const binding = makeBinding({ sandboxId: providerId })
    const harness = makeHarness({
      binding,
      flags: { "superserve-sandbox": bareId },
    })
    const connected = makeSandbox(providerId)
    const provider = makeProvider(undefined, connected.handle)
    const lifecycle = makeLifecycle(
      harness.pi,
      provider.provider,
      makeBootstrap(),
    )

    await lifecycle.start("startup", harness.ctx)

    expect(provider.connect).toHaveBeenCalledWith(providerId, {
      signal: undefined,
    })
    expect(appendedStates(harness.appended)).toEqual(["active"])
    expect(latestBinding(harness.appended).sandboxId).toBe(providerId)
  })

  it("rejects uppercase prefixes and different provider UUID identities", async () => {
    const requestedId = sandboxId(22)
    const differentId = sandboxId(23)
    expect(
      parseBinding(
        makeBinding({ sandboxId: `sb-usw-${requestedId.toUpperCase()}` }),
      ),
    ).toBeDefined()
    expect(
      parseBinding(
        makeBinding({ sandboxId: `SB-usw-${requestedId.toUpperCase()}` }),
      ),
    ).toBeUndefined()
    expect(
      parseBinding(
        makeBinding({ sandboxId: `sb-USW-${requestedId.toUpperCase()}` }),
      ),
    ).toBeUndefined()

    const harness = makeHarness()
    const returned = makeSandbox(differentId)
    const provider = makeProvider(undefined, returned.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

    await expect(lifecycle.connect(requestedId, harness.ctx)).rejects.toThrow(
      `returned sandbox ${differentId}, expected ${requestedId}`,
    )
    expect(bootstrap).not.toHaveBeenCalled()
    expect(latestBinding(harness.appended)).toMatchObject({
      state: "attaching",
      sandboxId: requestedId,
    })
  })

  it("rejects an invalid sandbox ID returned by the provider", async () => {
    const harness = makeHarness({ flags: { superserve: true } })
    const invalidSandbox = makeSandbox("not-a-sandbox-uuid")
    const provider = makeProvider(invalidSandbox.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)

    await lifecycle.start("startup", harness.ctx)

    expect(invalidSandbox.kill).toHaveBeenCalledOnce()
    expect(bootstrap).not.toHaveBeenCalled()
    expect(appendedStates(harness.appended)).toEqual([
      "provisioning",
      "missing",
    ])
    expect(latestBinding(harness.appended).sandboxId).toBeUndefined()
    expect(lifecycle.getActive()).toBeUndefined()
  })

  it("creates nested private downloads under the current cwd", async () => {
    const currentCwd = await mkdtemp(
      path.join(tmpdir(), "superserve-pi-lifecycle-"),
    )
    const outside = await mkdtemp(path.join(tmpdir(), "superserve-pi-outside-"))
    temporaryDirectories.push(currentCwd, outside)
    const archive = Buffer.from("PK\u0003\u0004sandbox archive")
    const downloadDir = vi.fn(async () => archive)
    const connected = makeSandbox(SANDBOX_EXISTING_ID)
    const connectedHandle = {
      ...connected.handle,
      files: { downloadDir } as unknown as SandboxHandle["files"],
    }
    const binding = makeBinding()
    const harness = makeHarness({
      binding,
      cwd: currentCwd,
      flags: { superserve: true },
    })
    const provider = makeProvider(undefined, connectedHandle)
    const lifecycle = makeLifecycle(
      harness.pi,
      provider.provider,
      makeBootstrap(),
    )
    await lifecycle.start("resume", harness.ctx)

    const result = await lifecycle.downloadWorkspace(
      "recovery/workspace.zip",
      harness.ctx,
    )

    const outputPath = path.join(currentCwd, "recovery", "workspace.zip")
    expect(result).toEqual({ path: outputPath, bytes: archive.byteLength })
    await expect(readFile(outputPath)).resolves.toEqual(archive)
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600)
    await expect(
      lifecycle.downloadWorkspace("../outside.zip", harness.ctx),
    ).rejects.toThrow("must stay inside the current cwd")
    await symlink(outside, path.join(currentCwd, "linked"))
    await expect(
      lifecycle.downloadWorkspace(
        "linked/must-not-exist/workspace.zip",
        harness.ctx,
      ),
    ).rejects.toThrow("must not contain symlinks")
    await expect(stat(path.join(outside, "must-not-exist"))).rejects.toThrow()
    expect(downloadDir).toHaveBeenCalledOnce()
  })

  it("pauses a managed sandbox on persistent-session shutdown", async () => {
    const binding = makeBinding({ state: "active" })
    const harness = makeHarness({
      binding,
      flags: { superserve: true },
      persistent: true,
    })
    const connected = makeSandbox(SANDBOX_EXISTING_ID)
    const provider = makeProvider(undefined, connected.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)
    await lifecycle.start("startup", harness.ctx)

    await lifecycle.shutdown("quit", harness.ctx)

    expect(connected.pause).toHaveBeenCalledOnce()
    expect(connected.kill).not.toHaveBeenCalled()
    expect(latestBinding(harness.appended).state).toBe("paused")
  })

  it("refuses kill without an already enabled and opted-in lifecycle", async () => {
    const dormantHarness = makeHarness()
    const dormantProvider = makeProvider()
    const dormantLifecycle = makeLifecycle(
      dormantHarness.pi,
      dormantProvider.provider,
      makeBootstrap(),
    )

    await expect(dormantLifecycle.kill(dormantHarness.ctx)).rejects.toThrow(
      "not enabled for this invocation",
    )
    expect(dormantHarness.setActiveTools).not.toHaveBeenCalled()
    expect(dormantProvider.killById).not.toHaveBeenCalled()

    const persistedHarness = makeHarness({ binding: makeBinding() })
    const persistedProvider = makeProvider()
    const persistedLifecycle = makeLifecycle(
      persistedHarness.pi,
      persistedProvider.provider,
      makeBootstrap(),
    )
    await persistedLifecycle.start("startup", persistedHarness.ctx)

    await expect(persistedLifecycle.kill(persistedHarness.ctx)).rejects.toThrow(
      "not enabled for this invocation",
    )
    expect(persistedProvider.killById).not.toHaveBeenCalled()
  })

  it("kills a managed sandbox on ephemeral-session shutdown", async () => {
    const harness = makeHarness({
      flags: { superserve: true },
      persistent: false,
    })
    const created = makeSandbox(SANDBOX_EPHEMERAL_ID)
    const provider = makeProvider(created.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)
    await lifecycle.start("startup", harness.ctx)

    await lifecycle.shutdown("quit", harness.ctx)

    expect(created.kill).toHaveBeenCalledOnce()
    expect(created.pause).not.toHaveBeenCalled()
    expect(latestBinding(harness.appended).state).toBe("destroyed")
  })

  it("persists a destroyed tombstone and never reconnects it implicitly", async () => {
    const binding = makeBinding({ state: "paused" })
    const harness = makeHarness({ binding, flags: { superserve: true } })
    const connected = makeSandbox(SANDBOX_EXISTING_ID)
    const provider = makeProvider(undefined, connected.handle)
    const bootstrap = makeBootstrap()
    const lifecycle = makeLifecycle(harness.pi, provider.provider, bootstrap)
    await lifecycle.start("startup", harness.ctx)

    await lifecycle.kill(harness.ctx)

    expect(connected.kill).toHaveBeenCalledOnce()
    expect(latestBinding(harness.appended)).toMatchObject({
      sandboxId: SANDBOX_EXISTING_ID,
      state: "destroyed",
    })
    const replacementLifecycle = makeLifecycle(
      harness.pi,
      provider.provider,
      bootstrap,
    )
    await replacementLifecycle.start("startup", harness.ctx)

    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.create).not.toHaveBeenCalled()
    expect(replacementLifecycle.getActive()).toBeUndefined()
    await expect(
      replacementLifecycle.requireSandbox(harness.ctx),
    ).rejects.toThrow("Superserve sandbox was destroyed")
  })
})
