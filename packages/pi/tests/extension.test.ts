import type {
  ExtensionAPI,
  ExtensionContext,
  SlashCommandInfo,
  SourceInfo,
  ToolInfo,
} from "@earendil-works/pi-coding-agent"
import { describe, expect, it, vi } from "vitest"

import {
  createSuperservePiExtension,
  type SuperservePiInvocationState,
  type SandboxBootstrap,
  type SandboxProvider,
} from "../src/index.js"

const LOCAL_CWD = "/host/private/project"
const ROUTED_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"]
const SANDBOX_EXISTING_ID = "00000000-0000-4000-8000-000000000001"

type RecordedHandler = (event: unknown, context: ExtensionContext) => unknown

interface RecordedFlag {
  description?: string
  type: "boolean" | "string"
  default?: boolean | string
}

interface RecordedCommand {
  description?: string
  handler: (argumentsText: string, context: ExtensionContext) => Promise<void>
}

interface ExtensionHarness {
  api: ExtensionAPI
  handlers: Map<string, RecordedHandler>
  flags: Map<string, RecordedFlag>
  commands: Map<string, RecordedCommand>
  getActiveTools: ReturnType<typeof vi.fn>
  getAllTools: ReturnType<typeof vi.fn>
  tools: string[]
  setActiveTools: ReturnType<typeof vi.fn>
}

interface LoadExtensionOptions {
  argv?: readonly string[]
  branch?: readonly unknown[]
  invocationState?: SuperservePiInvocationState
  piVersion?: string
  transformCommands?: (commands: SlashCommandInfo[]) => SlashCommandInfo[]
  transformTools?: (tools: ToolInfo[]) => ToolInfo[]
}

const EXTENSION_SOURCE: SourceInfo = {
  path: "/extensions/superserve-pi.js",
  source: "cli",
  scope: "temporary",
  origin: "top-level",
  baseDir: "/extensions",
}

function createHarness(
  flagValues: Record<string, boolean | string | undefined> = {},
  transformCommands: (commands: SlashCommandInfo[]) => SlashCommandInfo[] = (
    commands,
  ) => commands,
  transformTools: (tools: ToolInfo[]) => ToolInfo[] = (tools) => tools,
): ExtensionHarness {
  const handlers = new Map<string, RecordedHandler>()
  const flags = new Map<string, RecordedFlag>()
  const commands = new Map<string, RecordedCommand>()
  const tools: string[] = []
  const definitions: Array<Omit<ToolInfo, "sourceInfo">> = []
  let activeTools: string[] = []
  const getActiveTools = vi.fn(() => [...activeTools])
  const setActiveTools = vi.fn((names: string[]) => {
    activeTools = [...names]
  })
  const getAllTools = vi.fn(() =>
    transformTools(
      definitions.map((definition) => ({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        promptGuidelines: definition.promptGuidelines,
        sourceInfo: {
          path: EXTENSION_SOURCE.path,
          source: EXTENSION_SOURCE.source,
          scope: EXTENSION_SOURCE.scope,
          origin: EXTENSION_SOURCE.origin,
          baseDir: EXTENSION_SOURCE.baseDir,
        },
      })),
    ),
  )

  const api = {
    on: vi.fn((event: string, handler: RecordedHandler) => {
      handlers.set(event, handler)
    }),
    registerFlag: vi.fn((name: string, options: RecordedFlag) => {
      flags.set(name, options)
    }),
    getFlag: vi.fn((name: string) => flagValues[name]),
    registerCommand: vi.fn((name: string, command: RecordedCommand) => {
      commands.set(name, command)
    }),
    getCommands: vi.fn(() =>
      transformCommands(
        [...commands].map(([name, command]) => ({
          name,
          description: command.description,
          source: "extension" as const,
          sourceInfo: {
            path: EXTENSION_SOURCE.path,
            source: EXTENSION_SOURCE.source,
            scope: EXTENSION_SOURCE.scope,
            origin: EXTENSION_SOURCE.origin,
            baseDir: EXTENSION_SOURCE.baseDir,
          },
        })),
      ),
    ),
    registerTool: vi.fn((tool: Omit<ToolInfo, "sourceInfo">) => {
      tools.push(tool.name)
      definitions.push(tool)
      activeTools = [...new Set([...activeTools, tool.name])]
    }),
    getActiveTools,
    getAllTools,
    appendEntry: vi.fn(),
    setActiveTools,
  } as unknown as ExtensionAPI

  return {
    api,
    handlers,
    flags,
    commands,
    getActiveTools,
    getAllTools,
    tools,
    setActiveTools,
  }
}

function createContext(branch: readonly unknown[] = []): ExtensionContext {
  return {
    cwd: LOCAL_CWD,
    mode: "print",
    hasUI: false,
    signal: undefined,
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionFile: () => "/sessions/session-1.jsonl",
      getBranch: () => [...branch],
    },
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      theme: {
        fg: (_color: string, text: string) => text,
      },
    },
  } as unknown as ExtensionContext
}

function createFailingDependencies(): {
  provider: SandboxProvider
  bootstrap: SandboxBootstrap
} {
  return {
    provider: {
      create: vi.fn(async () => {
        throw new Error("provider offline")
      }),
      connect: vi.fn(async () => {
        throw new Error("unexpected connect")
      }),
      list: vi.fn(async () => []),
      killById: vi.fn(async () => undefined),
    },
    bootstrap: vi.fn(async () => {
      throw new Error("unexpected bootstrap")
    }),
  }
}

function loadExtension(
  flagValues: Record<string, boolean | string | undefined> = {},
  options: LoadExtensionOptions = {},
): {
  harness: ExtensionHarness
  context: ExtensionContext
  dependencies: ReturnType<typeof createFailingDependencies>
} {
  const harness = createHarness(
    flagValues,
    options.transformCommands,
    options.transformTools,
  )
  const context = createContext(options.branch)
  const dependencies = createFailingDependencies()
  createSuperservePiExtension({
    ...dependencies,
    argv: options.argv ?? [],
    invocationState: options.invocationState ?? { routingRequested: false },
    localCwd: LOCAL_CWD,
    piVersion: options.piVersion,
  })(harness.api)
  return { harness, context, dependencies }
}

async function invoke<TResult>(
  harness: ExtensionHarness,
  eventName: string,
  event: unknown,
  context: ExtensionContext,
): Promise<TResult | undefined> {
  const handler = harness.handlers.get(eventName)
  if (!handler) throw new Error(`No handler registered for ${eventName}`)
  return (await handler(event, context)) as TResult | undefined
}

async function enableSandboxMode(
  harness: ExtensionHarness,
  context: ExtensionContext,
): Promise<void> {
  await invoke(
    harness,
    "session_start",
    { type: "session_start", reason: "startup" },
    context,
  )
}

describe("@superserve/pi extension", () => {
  it("registers sandbox controls without overriding dormant tools", () => {
    const { harness } = loadExtension()

    expect([...harness.flags]).toEqual([
      [
        "superserve",
        expect.objectContaining({ type: "boolean", default: false }),
      ],
      [
        "superserve-template",
        expect.objectContaining({
          type: "string",
          default: "superserve/node-22",
        }),
      ],
      ["superserve-sandbox", expect.objectContaining({ type: "string" })],
      [
        "superserve-timeout",
        expect.objectContaining({ type: "string", default: "3600" }),
      ],
      [
        "superserve-auto-delete",
        expect.objectContaining({ type: "string", default: "86400" }),
      ],
      [
        "superserve-sync",
        expect.objectContaining({ type: "string", default: "tracked" }),
      ],
    ])
    expect([...harness.commands]).toEqual([
      [
        "superserve",
        expect.objectContaining({
          description: expect.stringContaining("Superserve sandbox"),
          handler: expect.any(Function),
        }),
      ],
    ])
    expect(harness.tools).toEqual([])
  })

  it.each([
    { superserve: true },
    { "superserve-sandbox": SANDBOX_EXISTING_ID },
  ])(
    "rejects host project trust when sandbox intent is present",
    async (flags) => {
      const { harness, context } = loadExtension(flags)

      const result = await invoke<{ trusted: string; remember?: boolean }>(
        harness,
        "project_trust",
        { type: "project_trust", cwd: LOCAL_CWD },
        context,
      )

      expect(result).toEqual({ trusted: "no", remember: false })
    },
  )

  it.each([
    ["--superserve"],
    ["--superserve=true"],
    ["--superserve-sandbox", SANDBOX_EXISTING_ID],
    [`--superserve-sandbox=${SANDBOX_EXISTING_ID}`],
  ])(
    "rejects host project trust from raw argv before Pi binds extension flags",
    async (...argv) => {
      const { harness, context } = loadExtension({}, { argv })

      const result = await invoke<{ trusted: string; remember?: boolean }>(
        harness,
        "project_trust",
        { type: "project_trust", cwd: LOCAL_CWD },
        context,
      )

      expect(result).toEqual({ trusted: "no", remember: false })
    },
  )

  it("leaves project trust undecided without sandbox intent", async () => {
    const { harness, context } = loadExtension({}, { argv: ["--print"] })

    const result = await invoke<{ trusted: string }>(
      harness,
      "project_trust",
      { type: "project_trust", cwd: LOCAL_CWD },
      context,
    )

    expect(result).toEqual({ trusted: "undecided" })
  })

  it("activates only the seven sandbox-routed tools", async () => {
    const { harness, context } = loadExtension({ superserve: true })

    await enableSandboxMode(harness, context)

    expect(new Set(harness.tools)).toEqual(new Set(ROUTED_TOOLS))
    expect(harness.tools).toHaveLength(ROUTED_TOOLS.length)
    expect(harness.setActiveTools).toHaveBeenCalledWith(ROUTED_TOOLS)
    expect(harness.setActiveTools).toHaveBeenCalledTimes(1)
    expect(harness.getActiveTools()).toEqual(ROUTED_TOOLS)
  })

  it("preserves active tools in dormant local sessions", async () => {
    const { harness, context } = loadExtension()
    const activeTools = harness.getActiveTools()

    await enableSandboxMode(harness, context)

    expect(harness.tools).toEqual([])
    expect(harness.getActiveTools()).toEqual(activeTools)
    expect(harness.setActiveTools).not.toHaveBeenCalled()
  })

  it("registers routed tools idempotently across repeated starts", async () => {
    const { harness, context } = loadExtension({ superserve: true })

    await enableSandboxMode(harness, context)
    await enableSandboxMode(harness, context)

    expect(new Set(harness.tools)).toEqual(new Set(ROUTED_TOOLS))
    expect(harness.tools).toHaveLength(ROUTED_TOOLS.length)
  })

  it("registers tools when a dormant session opts in through a command", async () => {
    const { harness, context } = loadExtension()
    await enableSandboxMode(harness, context)

    await harness.commands.get("superserve")?.handler("new", context)
    await harness.commands.get("superserve")?.handler("new", context)

    expect(new Set(harness.tools)).toEqual(new Set(ROUTED_TOOLS))
    expect(harness.tools).toHaveLength(ROUTED_TOOLS.length)
  })

  it("carries verified command opt-in into a fresh extension instance", async () => {
    const invocationState: SuperservePiInvocationState = {
      routingRequested: false,
    }
    const first = loadExtension({}, { invocationState })
    await enableSandboxMode(first.harness, first.context)
    await first.harness.commands
      .get("superserve")
      ?.handler("new", first.context)

    expect(invocationState.routingRequested).toBe(true)

    const second = loadExtension({}, { invocationState })
    expect(second.harness.tools).toEqual([])
    await enableSandboxMode(second.harness, second.context)

    expect(new Set(second.harness.tools)).toEqual(new Set(ROUTED_TOOLS))
    expect(second.harness.setActiveTools).toHaveBeenCalledWith(ROUTED_TOOLS)
    expect(second.dependencies.provider.create).toHaveBeenCalledTimes(1)
  })

  it("registers and verifies tools before handling a malformed binding entry", async () => {
    const hostileSource: SourceInfo = {
      path: "/extensions/host-tools.js",
      source: "local",
      scope: "user",
      origin: "top-level",
    }
    const { harness, context, dependencies } = loadExtension(
      {},
      {
        branch: [
          {
            type: "custom",
            customType: "superserve-sandbox",
            data: { malformed: true },
          },
        ],
        transformTools: (tools) =>
          tools.map((tool) =>
            tool.name === "read"
              ? { ...tool, sourceInfo: hostileSource }
              : tool,
          ),
      },
    )

    await enableSandboxMode(harness, context)

    expect(new Set(harness.tools)).toEqual(new Set(ROUTED_TOOLS))
    expect(harness.getActiveTools()).toEqual([])
    expect(dependencies.provider.create).not.toHaveBeenCalled()
  })

  it("fails closed when a routed tool comes from another extension", async () => {
    const hostileSource: SourceInfo = {
      path: "/extensions/host-tools.js",
      source: "local",
      scope: "user",
      origin: "top-level",
    }
    const { harness, context, dependencies } = loadExtension(
      { superserve: true },
      {
        transformTools: (tools) =>
          tools.map((tool) =>
            tool.name === "read"
              ? { ...tool, sourceInfo: hostileSource }
              : tool,
          ),
      },
    )

    await enableSandboxMode(harness, context)

    expect(dependencies.provider.create).not.toHaveBeenCalled()
    expect(harness.getActiveTools()).toEqual([])
    const toolCall = await invoke<{ block?: boolean; reason?: string }>(
      harness,
      "tool_call",
      {
        type: "tool_call",
        toolCallId: "call-read",
        toolName: "read",
        input: { path: "README.md" },
      },
      context,
    )
    expect(toolCall).toEqual({
      block: true,
      reason: expect.stringMatching(/source verification failed.*read/is),
    })

    const userBash = await invoke<{
      result?: { output: string; exitCode: number }
    }>(
      harness,
      "user_bash",
      {
        type: "user_bash",
        command: "pwd",
        excludeFromContext: false,
        cwd: LOCAL_CWD,
      },
      context,
    )
    expect(userBash?.result).toEqual(
      expect.objectContaining({
        output: expect.stringMatching(
          /source verification failed.*not run on the host/is,
        ),
        exitCode: 1,
      }),
    )
  })

  it("fails closed when the command source anchor is unavailable", async () => {
    const { harness, context, dependencies } = loadExtension(
      { superserve: true },
      {
        transformCommands: () => [],
      },
    )

    await enableSandboxMode(harness, context)

    expect(dependencies.provider.create).not.toHaveBeenCalled()
    expect(harness.getActiveTools()).toEqual([])
    expect(context.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/command source anchor is missing or ambiguous/i),
      "error",
    )
  })

  it("fails closed when provenance inspection throws", async () => {
    const { harness, context, dependencies } = loadExtension({
      superserve: true,
    })
    harness.getAllTools.mockImplementation(() => {
      throw new Error("tool registry unavailable")
    })

    await expect(enableSandboxMode(harness, context)).resolves.toBeUndefined()

    expect(dependencies.provider.create).not.toHaveBeenCalled()
    expect(harness.getActiveTools()).toEqual([])
    const toolCall = await invoke<{ block?: boolean; reason?: string }>(
      harness,
      "tool_call",
      {
        type: "tool_call",
        toolCallId: "call-read",
        toolName: "read",
        input: { path: "README.md" },
      },
      context,
    )
    expect(toolCall).toEqual({
      block: true,
      reason: expect.stringMatching(
        /source verification failed.*tool registry unavailable/is,
      ),
    })

    const userBash = await invoke<{
      result?: { output: string; exitCode: number }
    }>(
      harness,
      "user_bash",
      {
        type: "user_bash",
        command: "pwd",
        excludeFromContext: false,
        cwd: LOCAL_CWD,
      },
      context,
    )
    expect(userBash?.result).toEqual(
      expect.objectContaining({
        output: expect.stringMatching(
          /tool registry unavailable.*not run on the host/is,
        ),
        exitCode: 1,
      }),
    )
  })

  it("fails closed before tool registration on an unsupported Pi version", async () => {
    const { harness, context, dependencies } = loadExtension(
      { superserve: true },
      { piVersion: "0.81.0" },
    )

    await enableSandboxMode(harness, context)

    expect(harness.tools).toEqual([])
    expect(harness.getActiveTools()).toEqual([])
    expect(dependencies.provider.create).not.toHaveBeenCalled()
    const userBash = await invoke<{
      result?: { output: string; exitCode: number }
    }>(
      harness,
      "user_bash",
      {
        type: "user_bash",
        command: "pwd",
        excludeFromContext: false,
        cwd: LOCAL_CWD,
      },
      context,
    )
    expect(userBash?.result).toEqual(
      expect.objectContaining({
        output: expect.stringMatching(
          /unsupported Pi version 0\.81\.0.*not run on the host/is,
        ),
        exitCode: 1,
      }),
    )
  })

  it("blocks unknown model tools while allowing the routed tool names", async () => {
    const { harness, context } = loadExtension({ superserve: true })
    await enableSandboxMode(harness, context)

    const blocked = await invoke<{ block?: boolean; reason?: string }>(
      harness,
      "tool_call",
      {
        type: "tool_call",
        toolCallId: "call-1",
        toolName: "host_exec",
        input: {},
      },
      context,
    )

    expect(blocked).toEqual({
      block: true,
      reason: expect.stringMatching(/blocked.*host/i),
    })

    for (const toolName of ROUTED_TOOLS) {
      await expect(
        invoke(
          harness,
          "tool_call",
          {
            type: "tool_call",
            toolCallId: `call-${toolName}`,
            toolName,
            input: {},
          },
          context,
        ),
      ).resolves.toBeUndefined()
    }
  })

  it("returns a failed replacement for user bash when the sandbox is unavailable", async () => {
    const { harness, context } = loadExtension({ superserve: true })
    await enableSandboxMode(harness, context)

    const result = await invoke<{
      operations?: unknown
      result?: {
        output: string
        exitCode: number
        cancelled: boolean
        truncated: boolean
      }
    }>(
      harness,
      "user_bash",
      {
        type: "user_bash",
        command: "cat /etc/passwd",
        excludeFromContext: false,
        cwd: LOCAL_CWD,
      },
      context,
    )

    expect(result).toBeDefined()
    expect(result?.operations).toBeUndefined()
    expect(result?.result).toEqual({
      output: expect.stringMatching(/provider offline.*not run on the host/is),
      exitCode: 1,
      cancelled: false,
      truncated: false,
    })
  })

  it("rewrites the agent prompt to the guest workspace and states the network caveat", async () => {
    const { harness, context } = loadExtension({ superserve: true })
    await enableSandboxMode(harness, context)

    const result = await invoke<{ systemPrompt?: string }>(
      harness,
      "before_agent_start",
      {
        type: "before_agent_start",
        prompt: "inspect the repository",
        systemPrompt: `You are Pi.\nCurrent working directory: ${LOCAL_CWD}`,
        systemPromptOptions: {},
      },
      context,
    )

    expect(result?.systemPrompt).toContain(
      "Current working directory: /workspace (Superserve sandbox)",
    )
    expect(result?.systemPrompt).not.toContain(LOCAL_CWD)
    expect(result?.systemPrompt).toContain(
      "The host workspace is not directly available to tools.",
    )
    expect(result?.systemPrompt).toContain(
      "Network egress uses the provider default and is currently unrestricted.",
    )
  })
})
