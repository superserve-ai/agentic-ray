import {
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type SourceInfo,
  type UserBashEventResult,
} from "@earendil-works/pi-coding-agent"

import {
  DEFAULT_AUTO_DELETE_SECONDS,
  DEFAULT_TEMPLATE,
  DEFAULT_TIMEOUT_SECONDS,
  GUEST_WORKSPACE,
  ROUTED_TOOLS,
  SESSION_ENTRY_TYPE,
} from "./constants.js"
import {
  formatError,
  SandboxLifecycle,
  type LifecycleDependencies,
} from "./lifecycle.js"
import {
  createSandboxBashOperations,
  createSandboxToolRegistrar,
} from "./tools.js"

export interface SuperservePiOptions extends LifecycleDependencies {
  argv?: readonly string[]
  invocationState?: SuperservePiInvocationState
  localCwd?: string
  piVersion?: string
}

export interface SuperservePiInvocationState {
  routingRequested: boolean
}

export function createSuperservePiExtension(
  options: SuperservePiOptions = {},
): (pi: ExtensionAPI) => void {
  return (pi) => {
    registerFlags(pi)

    const localCwd = options.localCwd ?? process.cwd()
    const rawFlagIntent = hasRawFlagIntent(options.argv ?? process.argv)
    const compatibilityError = piCompatibilityError(
      options.piVersion ?? VERSION,
    )
    const invocationState =
      options.invocationState ?? getProcessInvocationState()
    const lifecycle = new SandboxLifecycle(
      createLifecycleApi(pi, invocationState),
      localCwd,
      options,
    )
    const registerSandboxTools = createSandboxToolRegistrar(pi, lifecycle)
    let routingRequired = rawFlagIntent || invocationState.routingRequested
    let routingVerificationError: string | undefined

    const verifyRouting = (): string | undefined => {
      if (compatibilityError) {
        routingVerificationError = compatibilityError
        return routingVerificationError
      }
      try {
        routingVerificationError = verifyRoutedToolSources(pi)
      } catch (error) {
        routingVerificationError = routingVerificationFailure(
          `provenance inspection failed: ${formatError(error)}`,
        )
      }
      return routingVerificationError
    }

    const failClosed = (
      error: string,
      ctx?: Pick<ExtensionContext, "ui">,
    ): void => {
      routingRequired = true
      routingVerificationError = error
      try {
        pi.setActiveTools([])
      } catch {
        // Event handlers must still return a fail-closed result if Pi state is stale.
      }
      try {
        ctx?.ui.notify(error, "error")
      } catch {
        // Notifications are optional and must not break the isolation decision.
      }
    }

    const registerRoutingTools = (): string | undefined => {
      if (compatibilityError) return compatibilityError
      try {
        registerSandboxTools()
        return undefined
      } catch (error) {
        return routingVerificationFailure(
          `tool registration failed: ${formatError(error)}`,
        )
      }
    }

    const requireVerifiedRouting = (): void => {
      routingRequired = true
      const registrationError = registerRoutingTools()
      if (registrationError) {
        failClosed(registrationError)
        throw new Error(registrationError)
      }
      const verificationError = verifyRouting()
      if (verificationError) {
        failClosed(verificationError)
        throw new Error(verificationError)
      }
      invocationState.routingRequested = true
    }

    pi.on("project_trust", () => {
      if (
        !rawFlagIntent &&
        !invocationState.routingRequested &&
        !lifecycle.hasFlagIntent()
      ) {
        return { trusted: "undecided" }
      }
      return { trusted: "no", remember: false }
    })

    pi.on("session_start", async (event, ctx) => {
      const invocationRequested =
        rawFlagIntent ||
        invocationState.routingRequested ||
        lifecycle.hasFlagIntent()
      routingRequired = invocationRequested || hasSessionBinding(ctx)
      let verificationError: string | undefined
      if (routingRequired) {
        const registrationError = registerRoutingTools()
        if (registrationError) {
          failClosed(registrationError, ctx)
          return
        }
        verificationError = verifyRouting()
        if (verificationError) {
          failClosed(verificationError, ctx)
          return
        }
        if (invocationRequested) invocationState.routingRequested = true
      }

      await lifecycle.start(event.reason, ctx)
      if (!routingRequired && lifecycle.isEnabled()) {
        routingRequired = true
        const registrationError = registerRoutingTools()
        if (registrationError) {
          failClosed(registrationError, ctx)
          return
        }
        verificationError = verifyRouting()
        if (!verificationError) {
          invocationState.routingRequested = true
          pi.setActiveTools([...ROUTED_TOOLS])
        }
      }

      if (!lifecycle.isEnabled()) {
        if (routingRequired) pi.setActiveTools([])
        return
      }

      if (verificationError) failClosed(verificationError, ctx)
    })

    pi.on("session_shutdown", async (event, ctx) => {
      await lifecycle.shutdown(event.reason, ctx)
    })

    pi.on("tool_call", (event) => {
      const secureMode = routingRequired || lifecycle.isEnabled()
      if (!secureMode) return
      routingRequired = true

      const verificationError = verifyRouting()
      if (verificationError) {
        failClosed(verificationError)
        return { block: true, reason: verificationError }
      }
      if (!lifecycle.isEnabled()) {
        return {
          block: true,
          reason:
            "Superserve mode was requested but did not initialize. The tool was blocked rather than executed on the host.",
        }
      }
      if (ROUTED_TOOLS.has(event.toolName)) return
      return {
        block: true,
        reason: `Tool "${event.toolName}" is not routed through Superserve. It was blocked rather than executed on the host.`,
      }
    })

    pi.on(
      "user_bash",
      async (_event, ctx): Promise<UserBashEventResult | undefined> => {
        const secureMode = routingRequired || lifecycle.isEnabled()
        if (!secureMode) return undefined
        routingRequired = true

        const verificationError = verifyRouting()
        if (verificationError || !lifecycle.isEnabled()) {
          const detail =
            verificationError ??
            "Superserve mode was requested but did not initialize"
          return failedUserBashResult(detail)
        }
        try {
          const active = await lifecycle.requireSandbox(ctx)
          return {
            operations: createSandboxBashOperations(active, ctx.cwd),
          }
        } catch (error) {
          return failedUserBashResult(formatError(error))
        }
      },
    )

    pi.on("before_agent_start", (event, ctx) => {
      if (!lifecycle.isEnabled()) return
      const localLine = `Current working directory: ${ctx.cwd}`
      const remoteLine = `Current working directory: ${GUEST_WORKSPACE} (Superserve sandbox)`
      const systemPrompt = event.systemPrompt.includes(localLine)
        ? event.systemPrompt.replace(localLine, remoteLine)
        : `${event.systemPrompt}\n\n${remoteLine}`
      return {
        systemPrompt: `${systemPrompt}\n\nAll shell and filesystem tools are routed to the Superserve sandbox. The host workspace is not directly available to tools. Network egress uses the provider default and is currently unrestricted.`,
      }
    })

    pi.registerCommand("superserve", {
      description:
        "Manage the Superserve sandbox: status, pause, resume, list, connect, kill, new, or download",
      handler: async (argumentsText, ctx) => {
        const parts = argumentsText.trim().split(/\s+/).filter(Boolean)
        const action = parts.shift() ?? "status"
        const value = parts.join(" ") || undefined
        try {
          switch (action) {
            case "status":
              ctx.ui.notify(lifecycle.statusLines().join("\n"), "info")
              return
            case "pause":
              await lifecycle.pause(ctx)
              ctx.ui.notify("Superserve sandbox paused", "info")
              return
            case "resume": {
              requireVerifiedRouting()
              const active = await lifecycle.requireSandbox(ctx)
              ctx.ui.notify(
                `Superserve sandbox active: ${active.sandbox.id}`,
                "info",
              )
              return
            }
            case "list": {
              const sandboxes = await lifecycle.list()
              const output =
                sandboxes.length === 0
                  ? "No Pi-created Superserve sandboxes found"
                  : sandboxes
                      .map(
                        (sandbox) =>
                          `${sandbox.id}  ${sandbox.status}  ${sandbox.name}`,
                      )
                      .join("\n")
              ctx.ui.notify(output, "info")
              return
            }
            case "connect": {
              requireVerifiedRouting()
              const active = await lifecycle.connect(value ?? "", ctx)
              ctx.ui.notify(
                `Connected to Superserve sandbox ${active.sandbox.id}`,
                "info",
              )
              return
            }
            case "kill":
              await lifecycle.kill(ctx)
              ctx.ui.notify("Superserve sandbox destroyed", "warning")
              return
            case "new": {
              requireVerifiedRouting()
              const active = await lifecycle.createNew(ctx)
              ctx.ui.notify(
                `Created Superserve sandbox ${active.sandbox.id}`,
                "info",
              )
              return
            }
            case "download": {
              const result = await lifecycle.downloadWorkspace(value, ctx)
              ctx.ui.notify(
                `Saved ${result.bytes} bytes to ${result.path}`,
                "info",
              )
              return
            }
            default:
              throw new Error(
                "Usage: /superserve [status|pause|resume|list|connect <id>|kill|new|download [output.zip]]",
              )
          }
        } catch (error) {
          ctx.ui.notify(formatError(error), "error")
        }
      },
    })
  }
}

function verifyRoutedToolSources(pi: ExtensionAPI): string | undefined {
  const sourceAnchors = pi
    .getCommands()
    .filter((command) => command.name === "superserve")
  if (sourceAnchors.length !== 1) {
    return routingVerificationFailure(
      "the /superserve command source anchor is missing or ambiguous",
    )
  }

  const tools = pi.getAllTools()
  const sourceAnchor = sourceAnchors[0]

  const missing: string[] = []
  const conflicting: string[] = []
  for (const name of ROUTED_TOOLS) {
    const tool = tools.find((candidate) => candidate.name === name)
    if (!tool) missing.push(name)
    else if (!sameSourceInfo(tool.sourceInfo, sourceAnchor.sourceInfo)) {
      conflicting.push(name)
    }
  }

  const details: string[] = []
  if (missing.length > 0) details.push(`missing: ${missing.join(", ")}`)
  if (conflicting.length > 0) {
    details.push(`registered by another source: ${conflicting.join(", ")}`)
  }
  return details.length > 0
    ? routingVerificationFailure(details.join("; "))
    : undefined
}

function sameSourceInfo(left: SourceInfo, right: SourceInfo): boolean {
  return (
    left.path === right.path &&
    left.source === right.source &&
    left.scope === right.scope &&
    left.origin === right.origin &&
    left.baseDir === right.baseDir
  )
}

function routingVerificationFailure(detail: string): string {
  return `Superserve routing source verification failed (${detail}). All tools were disabled; use the secure exclusive launcher.`
}

function piCompatibilityError(version: string): string | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:([+-]).*)?$/.exec(version)
  const supported =
    match !== null &&
    match[4] !== "-" &&
    Number(match[1]) === 0 &&
    Number(match[2]) === 80 &&
    Number(match[3]) >= 9
  return supported
    ? undefined
    : `Unsupported Pi version ${version}; @superserve/pi requires >=0.80.9 <0.81.0. All tools were disabled rather than risking host execution.`
}

function hasRawFlagIntent(argv: readonly string[]): boolean {
  return argv.some(
    (argument) =>
      argument === "--superserve" ||
      argument.startsWith("--superserve=") ||
      argument === "--superserve-sandbox" ||
      argument.startsWith("--superserve-sandbox="),
  )
}

function hasSessionBinding(ctx: ExtensionContext): boolean {
  return ctx.sessionManager
    .getBranch()
    .some(
      (entry) =>
        entry?.type === "custom" && entry.customType === SESSION_ENTRY_TYPE,
    )
}

const INVOCATION_STATE_KEY = Symbol.for("@superserve/pi/invocation-state/v1")

function getProcessInvocationState(): SuperservePiInvocationState {
  const processGlobals = globalThis as typeof globalThis & {
    [key: symbol]: unknown
  }
  const existing = processGlobals[INVOCATION_STATE_KEY]
  if (
    typeof existing === "object" &&
    existing !== null &&
    "routingRequested" in existing &&
    typeof existing.routingRequested === "boolean"
  ) {
    return existing as SuperservePiInvocationState
  }
  const created: SuperservePiInvocationState = { routingRequested: false }
  processGlobals[INVOCATION_STATE_KEY] = created
  return created
}

function createLifecycleApi(
  pi: ExtensionAPI,
  invocationState: SuperservePiInvocationState,
): ExtensionAPI {
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property !== "getFlag") return Reflect.get(target, property, receiver)
      return (name: string): boolean | string | undefined => {
        if (name === "superserve" && invocationState.routingRequested) {
          return true
        }
        return target.getFlag(name)
      }
    },
  })
}

function failedUserBashResult(detail: string): UserBashEventResult {
  return {
    result: {
      output: `Superserve unavailable: ${detail}\nThe command was not run on the host.`,
      exitCode: 1,
      cancelled: false,
      truncated: false,
    },
  }
}

function registerFlags(pi: ExtensionAPI): void {
  pi.registerFlag("superserve", {
    description: "Run Pi tools in a Superserve sandbox",
    type: "boolean",
    default: false,
  })
  pi.registerFlag("superserve-template", {
    description: `Sandbox template (default: ${DEFAULT_TEMPLATE})`,
    type: "string",
    default: DEFAULT_TEMPLATE,
  })
  pi.registerFlag("superserve-sandbox", {
    description: "Connect to an existing Superserve sandbox ID",
    type: "string",
  })
  pi.registerFlag("superserve-timeout", {
    description: "Auto-pause timeout in seconds",
    type: "string",
    default: String(DEFAULT_TIMEOUT_SECONDS),
  })
  pi.registerFlag("superserve-auto-delete", {
    description: "Delete after this many paused seconds, or none",
    type: "string",
    default: String(DEFAULT_AUTO_DELETE_SECONDS),
  })
  pi.registerFlag("superserve-sync", {
    description: "Initial workspace upload: tracked or none",
    type: "string",
    default: "tracked",
  })
}

export default createSuperservePiExtension()

export { SandboxLifecycle } from "./lifecycle.js"
export type {
  ActiveSandbox,
  SandboxBinding,
  SandboxBootstrap,
  SandboxHandle,
  SandboxProvider,
} from "./types.js"
