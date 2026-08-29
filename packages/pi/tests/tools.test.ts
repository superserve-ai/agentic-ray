import { Buffer } from "node:buffer"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  DEFAULT_MAX_BYTES,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import { TimeoutError } from "@superserve/sdk"
import { afterEach, describe, expect, it, vi } from "vitest"

import { callBridge } from "../src/bridge.js"
import {
  BRIDGE_PATH,
  GUEST_WORKSPACE,
  MAX_BRIDGE_OUTPUT_BYTES,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_TIMEOUT_SECONDS,
  MAX_FILE_READ_BYTES,
  ROUTED_TOOL_NAMES,
} from "../src/constants.js"
import { createSuperservePiExtension } from "../src/index.js"
import { SandboxLifecycle } from "../src/lifecycle.js"
import {
  createSandboxBashOperations,
  createSandboxToolRegistrar,
} from "../src/tools.js"
import type {
  ActiveSandbox,
  SandboxBinding,
  SandboxHandle,
  SandboxProvider,
} from "../src/types.js"

const HOST_CWD = "/Users/developer/project"
const GUEST_HOME = "/home/sandbox"
const SANDBOX_ID = "22222222-2222-4222-8222-222222222222"

interface ToolResult {
  content: Array<{
    type: string
    text?: string
    data?: string
    mimeType?: string
  }>
  details?: unknown
}

interface CallableTool {
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ): Promise<ToolResult>
}

interface EventHandler {
  (event: unknown, ctx: ExtensionContext): unknown | Promise<unknown>
}

interface CommandOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  maxOutputBytes?: number
}

interface BridgeRequest {
  action: string
  command: string
  input: Record<string, unknown>
  options: CommandOptions
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function createPiHarness(initialFlags: Record<string, boolean | string> = {}) {
  const handlers = new Map<string, EventHandler[]>()
  const tools = new Map<string, ToolDefinition>()
  const commands = new Map<string, Record<string, unknown>>()
  const flags = new Map<string, boolean | string>(Object.entries(initialFlags))
  const entries: Array<{ customType: string; data: unknown }> = []
  const activeTools: string[][] = []
  const sourceInfo = {
    path: "/test/superserve-pi.js",
    source: "explicit",
    scope: "global",
    origin: "test",
    baseDir: "/test",
  }

  const api = {
    on: (event: string, handler: EventHandler) => {
      const registered = handlers.get(event) ?? []
      registered.push(handler)
      handlers.set(event, registered)
    },
    registerTool: (tool: ToolDefinition) => {
      tools.set(tool.name, tool)
    },
    registerCommand: (name: string, command: Record<string, unknown>) => {
      commands.set(name, command)
    },
    getAllTools: () => {
      const registered = []
      for (const tool of tools.values()) {
        registered.push(Object.assign({}, tool, { sourceInfo }))
      }
      return registered
    },
    getCommands: () => {
      const registered = []
      for (const [name, command] of commands) {
        registered.push(Object.assign({}, command, { name, sourceInfo }))
      }
      return registered
    },
    registerFlag: (name: string, options: { default?: boolean | string }) => {
      if (!flags.has(name) && options.default !== undefined) {
        flags.set(name, options.default)
      }
    },
    getFlag: (name: string) => flags.get(name),
    appendEntry: (customType: string, data: unknown) => {
      entries.push({ customType, data })
    },
    setActiveTools: (names: string[]) => {
      activeTools.push(names)
    },
  } as unknown as ExtensionAPI

  return {
    api,
    activeTools,
    commands,
    entries,
    flags,
    handlers,
    tools,
    async emit(
      event: string,
      payload: unknown,
      ctx: ExtensionContext,
    ): Promise<unknown> {
      let result: unknown
      for (const handler of handlers.get(event) ?? []) {
        const next = await handler(payload, ctx)
        if (next !== undefined) result = next
      }
      return result
    },
    tool(name: string): CallableTool {
      const tool = tools.get(name)
      if (!tool) throw new Error(`Tool not registered: ${name}`)
      return tool as unknown as CallableTool
    },
  }
}

function createContext(
  options: {
    cwd?: string
    persistent?: boolean
    sessionId?: string
  } = {},
): ExtensionContext {
  const cwd = options.cwd ?? HOST_CWD
  return {
    cwd,
    hasUI: false,
    mode: "print",
    model: undefined,
    signal: undefined,
    sessionManager: {
      getSessionId: () => options.sessionId ?? "session-1",
      getSessionFile: () =>
        options.persistent === false ? undefined : "/tmp/session.jsonl",
      getBranch: () => [],
    },
    ui: {},
  } as unknown as ExtensionContext
}

function createSandboxHarness() {
  const bridgeRequests: BridgeRequest[] = []
  const files = new Map<string, Uint8Array>([
    ["/workspace/src/read.ts", Buffer.from("export const read = true\n")],
    ["/workspace/src/edit.ts", Buffer.from("const state = 'old'\n")],
    [
      "/workspace/image.png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
  ])

  const commandsRun = vi.fn(
    async (command: string, options: CommandOptions = {}) => {
      if (command.startsWith(`node ${BRIDGE_PATH} `)) {
        const action = command.slice(`node ${BRIDGE_PATH} `.length)
        const encoded = options.env?.SUPERSERVE_PI_INPUT
        if (!encoded) throw new Error("Missing bridge input")
        const input = JSON.parse(
          Buffer.from(encoded, "base64url").toString("utf8"),
        ) as Record<string, unknown>
        bridgeRequests.push({ action, command, input, options })

        let value: unknown
        switch (action) {
          case "access":
            value = null
            break
          case "exists":
            value = true
            break
          case "list":
            value = {
              exists: true,
              isDirectory: true,
              entries: [
                { name: "nested", isDirectory: true },
                { name: "read.ts", isDirectory: false },
              ],
            }
            break
          case "glob":
            value = ["/workspace/src/read.ts", "/workspace/src/edit.ts"]
            break
          case "grep":
            value = {
              output: "src/read.ts:1: export const read = true",
              matchLimitReached: false,
              linesTruncated: false,
              responseLimitReached: false,
            }
            break
          case "home":
            value = GUEST_HOME
            break
          case "stat":
            value = { isDirectory: false }
            break
          case "read":
            value =
              input.path === "/workspace/image.png"
                ? {
                    kind: "image",
                    mimeType: "image/png",
                    size: files.get("/workspace/image.png")?.byteLength,
                  }
                : input.path === "/workspace/large.txt"
                  ? {
                      kind: "text",
                      content:
                        "selected 900000\nselected 900001\nselected 900002",
                      contentLimitReached: false,
                      firstLineBytes: 15,
                      selectedLines: 3,
                      totalLines: 1_000_000,
                    }
                  : {
                      kind: "text",
                      content: "export const read = true\n",
                      contentLimitReached: false,
                      firstLineBytes: 24,
                      selectedLines: 2,
                      totalLines: 2,
                    }
            break
          default:
            throw new Error(`Unexpected bridge action: ${action}`)
        }
        return {
          stdout: JSON.stringify({ ok: true, value }),
          stderr: "",
          exitCode: 0,
        }
      }

      return {
        stdout: "remote stdout\n",
        stderr: "remote stderr\n",
        exitCode: 0,
      }
    },
  )
  const filesRead = vi.fn(async (filePath: string) => {
    const content = files.get(filePath)
    if (!content) throw new Error(`Missing fake file: ${filePath}`)
    return content
  })
  const filesWrite = vi.fn(
    async (filePath: string, content: string | Uint8Array) => {
      files.set(
        filePath,
        typeof content === "string" ? Buffer.from(content) : content,
      )
    },
  )
  const pause = vi.fn(async () => {})
  const kill = vi.fn(async () => {})
  const resume = vi.fn(async () => {})

  const sandbox = {
    id: SANDBOX_ID,
    name: "pi-project",
    status: "running",
    metadata: {},
    commands: { run: commandsRun },
    files: { read: filesRead, write: filesWrite },
    getInfo: vi.fn(),
    pause,
    resume,
    kill,
  } as unknown as SandboxHandle

  return {
    bridgeRequests,
    commandsRun,
    files,
    filesRead,
    filesWrite,
    kill,
    pause,
    sandbox,
  }
}

function createProvider(sandbox: SandboxHandle): SandboxProvider {
  return {
    create: vi.fn(async () => sandbox),
    connect: vi.fn(async () => sandbox),
    list: vi.fn(async () => []),
    killById: vi.fn(async () => {}),
  }
}

function text(result: ToolResult): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n")
}

function fakeBinding(): SandboxBinding {
  return {
    version: 1,
    ownerSessionId: "session-1",
    clientId: "client-1",
    bindingId: "binding-1",
    state: "active",
    managed: true,
    sandboxId: SANDBOX_ID,
    workspacePath: GUEST_WORKSPACE,
    guestHome: GUEST_HOME,
    template: "superserve/node-22",
    timeoutSeconds: 3_600,
    autoDeleteSeconds: 86_400,
    sync: "tracked",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("Superserve Pi tools", () => {
  it("registers and routes all seven built-in tools into one sandbox", async () => {
    const pi = createPiHarness({ superserve: true })
    const remote = createSandboxHarness()
    const provider = createProvider(remote.sandbox)
    const bootstrap = vi.fn(async () => ({
      guestHome: GUEST_HOME,
      syncedFiles: 0,
      syncedBytes: 0,
    }))
    createSuperservePiExtension({
      localCwd: HOST_CWD,
      provider,
      bootstrap,
      randomId: () => "fixed-id",
    })(pi.api)
    const ctx = createContext()

    expect([...pi.tools]).toEqual([])
    await pi.emit("session_start", { reason: "startup" }, ctx)
    expect([...pi.tools.keys()].toSorted()).toEqual(
      [...ROUTED_TOOL_NAMES].toSorted(),
    )
    expect(pi.activeTools.at(-1)).toEqual([...ROUTED_TOOL_NAMES])

    const readResult = await pi
      .tool("read")
      .execute(
        "read-1",
        { path: `${HOST_CWD}/src/read.ts` },
        undefined,
        undefined,
        ctx,
      )
    expect(text(readResult)).toContain("export const read = true")

    await pi
      .tool("write")
      .execute(
        "write-1",
        { path: "~/notes.txt", content: "sandbox only" },
        undefined,
        undefined,
        ctx,
      )
    expect(remote.files.get(`${GUEST_HOME}/notes.txt`)).toEqual(
      Buffer.from("sandbox only"),
    )

    await pi.tool("edit").execute(
      "edit-1",
      {
        path: "src/edit.ts",
        edits: [{ oldText: "'old'", newText: "'new'" }],
      },
      undefined,
      undefined,
      ctx,
    )
    expect(remote.files.get("/workspace/src/edit.ts")?.toString()).toBe(
      "const state = 'new'\n",
    )

    const bashResult = await pi
      .tool("bash")
      .execute(
        "bash-1",
        { command: "pwd", timeout: 30 },
        undefined,
        undefined,
        ctx,
      )
    expect(text(bashResult)).toContain("remote stdout")

    const lsResult = await pi
      .tool("ls")
      .execute("ls-1", { path: HOST_CWD }, undefined, undefined, ctx)
    expect(text(lsResult)).toContain("nested/")
    expect(text(lsResult)).toContain("read.ts")

    const findResult = await pi
      .tool("find")
      .execute(
        "find-1",
        { path: GUEST_WORKSPACE, pattern: "**/*.ts" },
        undefined,
        undefined,
        ctx,
      )
    expect(text(findResult)).toBe("src/read.ts\nsrc/edit.ts")

    const grepResult = await pi
      .tool("grep")
      .execute(
        "grep-1",
        { path: HOST_CWD, pattern: "read" },
        undefined,
        undefined,
        ctx,
      )
    expect(text(grepResult)).toBe("src/read.ts:1: export const read = true")

    expect(remote.filesRead).toHaveBeenCalledWith(
      "/workspace/src/edit.ts",
      expect.objectContaining({ maxBytes: MAX_FILE_READ_BYTES }),
    )
    expect(remote.filesRead).not.toHaveBeenCalledWith(
      "/workspace/src/read.ts",
      expect.anything(),
    )
    expect(remote.bridgeRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "read",
          input: {
            path: "/workspace/src/read.ts",
            offset: 1,
            limit: undefined,
          },
        }),
        expect.objectContaining({
          action: "access",
          input: { path: "/workspace/src/edit.ts" },
        }),
        expect.objectContaining({
          action: "list",
          input: { path: GUEST_WORKSPACE, limit: 501 },
        }),
        expect.objectContaining({
          action: "glob",
          input: expect.objectContaining({ path: GUEST_WORKSPACE }),
        }),
        expect.objectContaining({
          action: "grep",
          input: expect.objectContaining({ path: GUEST_WORKSPACE }),
        }),
      ]),
    )

    const routedEvents = await Promise.all(
      ROUTED_TOOL_NAMES.map((toolName) =>
        pi.emit(
          "tool_call",
          {
            type: "tool_call",
            toolCallId: `${toolName}-call`,
            toolName,
            input: {},
          },
          ctx,
        ),
      ),
    )
    expect(routedEvents).toEqual(ROUTED_TOOL_NAMES.map(() => undefined))
    await expect(
      pi.emit(
        "tool_call",
        {
          type: "tool_call",
          toolCallId: "host-tool-call",
          toolName: "host_tool",
          input: {},
        },
        ctx,
      ),
    ).resolves.toMatchObject({ block: true })
  })

  it("fails closed for all directly registered tools while lifecycle is disabled", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "superserve-pi-test-"))
    temporaryDirectories.push(directory)
    const existing = path.join(directory, "existing.txt")
    const newFile = path.join(directory, "new.txt")
    const shellMarker = path.join(directory, "shell-ran")
    await writeFile(existing, "unchanged\n")

    const pi = createPiHarness()
    const remote = createSandboxHarness()
    const provider = createProvider(remote.sandbox)
    const lifecycle = new SandboxLifecycle(pi.api, HOST_CWD, { provider })
    createSandboxToolRegistrar(pi.api, lifecycle)()
    const ctx = createContext({ cwd: directory })

    const calls: Array<[string, Record<string, unknown>]> = [
      ["read", { path: existing }],
      ["write", { path: newFile, content: "must not be written" }],
      [
        "edit",
        {
          path: existing,
          edits: [{ oldText: "unchanged", newText: "changed" }],
        },
      ],
      ["bash", { command: `touch ${shellMarker}` }],
      ["grep", { path: directory, pattern: "unchanged" }],
      ["find", { path: directory, pattern: "*.txt" }],
      ["ls", { path: directory }],
    ]
    for (const [toolName, params] of calls) {
      await expect(
        pi
          .tool(toolName)
          .execute(`${toolName}-disabled`, params, undefined, undefined, ctx),
      ).rejects.toThrow("Superserve sandbox mode is not enabled")
    }

    expect(await readFile(existing, "utf8")).toBe("unchanged\n")
    await expect(readFile(newFile)).rejects.toThrow()
    await expect(readFile(shellMarker)).rejects.toThrow()
    expect(provider.create).not.toHaveBeenCalled()
    expect(provider.connect).not.toHaveBeenCalled()
    expect(remote.commandsRun).not.toHaveBeenCalled()
    expect(remote.filesRead).not.toHaveBeenCalled()
    expect(remote.filesWrite).not.toHaveBeenCalled()
  })

  it("does not resolve remote read paths using host filesystem existence", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "superserve-pi-project-"))
    const outside = await mkdtemp(path.join(tmpdir(), "superserve-pi-probe-"))
    temporaryDirectories.push(project, outside)
    const requestedPath = path.join(outside, "Capture 1.00 PM.txt")
    const hostOnlyVariant = requestedPath.replace(" PM", "\u202fPM")
    await writeFile(hostOnlyVariant, "host-only variant\n")

    const pi = createPiHarness({ superserve: true })
    const remote = createSandboxHarness()
    createSuperservePiExtension({
      localCwd: project,
      provider: createProvider(remote.sandbox),
      bootstrap: vi.fn(async () => ({
        guestHome: GUEST_HOME,
        syncedFiles: 0,
        syncedBytes: 0,
      })),
      randomId: () => "fixed-id",
    })(pi.api)
    const ctx = createContext({ cwd: project })
    await pi.emit("session_start", { reason: "startup" }, ctx)

    await pi
      .tool("read")
      .execute(
        "read-no-host-probe",
        { path: requestedPath },
        undefined,
        undefined,
        ctx,
      )

    const request = remote.bridgeRequests.find(
      (candidate) => candidate.action === "read",
    )
    expect(request?.input.path).toBe(requestedPath)
    expect(request?.input.path).not.toBe(hostOnlyVariant)
    expect(remote.filesRead).not.toHaveBeenCalled()
  })

  it("reads a bounded line range at a large offset without downloading the file", async () => {
    const executionCwd = "/different/session/project"
    const pi = createPiHarness({ superserve: true })
    const remote = createSandboxHarness()
    createSuperservePiExtension({
      localCwd: HOST_CWD,
      provider: createProvider(remote.sandbox),
      bootstrap: vi.fn(async () => ({
        guestHome: GUEST_HOME,
        syncedFiles: 0,
        syncedBytes: 0,
      })),
      randomId: () => "fixed-id",
    })(pi.api)
    const ctx = createContext({ cwd: executionCwd })
    await pi.emit("session_start", { reason: "startup" }, ctx)

    const result = await pi.tool("read").execute(
      "read-large-offset",
      {
        path: `${executionCwd}/large.txt`,
        offset: 900_000,
        limit: 3,
      },
      undefined,
      undefined,
      ctx,
    )

    expect(text(result)).toContain("selected 900000")
    expect(text(result)).toContain(
      "[99998 more lines in file. Use offset=900003 to continue.]",
    )
    expect(remote.bridgeRequests).toContainEqual(
      expect.objectContaining({
        action: "read",
        input: {
          path: "/workspace/large.txt",
          offset: 900_000,
          limit: 3,
        },
      }),
    )
    expect(remote.filesRead).not.toHaveBeenCalled()
  })

  it("returns a bounded bash tail without creating a host full-output artifact", async () => {
    const pi = createPiHarness({ superserve: true })
    const remote = createSandboxHarness()
    createSuperservePiExtension({
      localCwd: HOST_CWD,
      provider: createProvider(remote.sandbox),
      bootstrap: vi.fn(async () => ({
        guestHome: GUEST_HOME,
        syncedFiles: 0,
        syncedBytes: 0,
      })),
      randomId: () => "fixed-id",
    })(pi.api)
    const ctx = createContext()
    await pi.emit("session_start", { reason: "startup" }, ctx)
    remote.commandsRun.mockResolvedValueOnce({
      stdout: "untrusted output\n".repeat(10_000),
      stderr: "",
      exitCode: 0,
    })

    const result = await pi
      .tool("bash")
      .execute(
        "bash-bounded",
        { command: "generate-output" },
        undefined,
        undefined,
        ctx,
      )

    expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(
      DEFAULT_MAX_BYTES,
    )
    expect(text(result)).toContain(
      "Superserve command output truncated to a bounded tail",
    )
    expect(result.details).toBeUndefined()
    expect(text(result)).not.toContain("Full output: /tmp/pi-bash-")
  })

  it("attaches only a bounded, magic-verified remote image", async () => {
    const pi = createPiHarness({ superserve: true })
    const remote = createSandboxHarness()
    createSuperservePiExtension({
      localCwd: HOST_CWD,
      provider: createProvider(remote.sandbox),
      bootstrap: vi.fn(async () => ({
        guestHome: GUEST_HOME,
        syncedFiles: 0,
        syncedBytes: 0,
      })),
      randomId: () => "fixed-id",
    })(pi.api)
    const ctx = createContext()
    await pi.emit("session_start", { reason: "startup" }, ctx)

    const result = await pi
      .tool("read")
      .execute("read-image", { path: "image.png" }, undefined, undefined, ctx)

    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Read image file [image/png]"),
      },
      {
        type: "image",
        data: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]).toString("base64"),
        mimeType: "image/png",
      },
    ])
    expect(remote.filesRead).toHaveBeenCalledWith("/workspace/image.png", {
      maxBytes: MAX_FILE_READ_BYTES,
      signal: undefined,
    })
  })

  it("describes Superserve search ignore behavior accurately", () => {
    const pi = createPiHarness()
    const remote = createSandboxHarness()
    const lifecycle = new SandboxLifecycle(pi.api, HOST_CWD, {
      provider: createProvider(remote.sandbox),
    })
    createSandboxToolRegistrar(pi.api, lifecycle)()

    for (const name of ["find", "grep"]) {
      expect(pi.tools.get(name)?.description).toContain(
        ".gitignore rules are not evaluated",
      )
    }
  })

  it("fails closed for every tool and user bash when sandbox setup is missing", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "superserve-pi-test-"))
    temporaryDirectories.push(directory)
    const existing = path.join(directory, "existing.txt")
    const newFile = path.join(directory, "new.txt")
    const shellMarker = path.join(directory, "shell-ran")
    await writeFile(existing, "unchanged\n")

    const pi = createPiHarness({ superserve: true })
    const remote = createSandboxHarness()
    const provider = createProvider(remote.sandbox)
    const bootstrap = vi.fn(async () => {
      throw new Error("sandbox bootstrap failed")
    })
    createSuperservePiExtension({
      localCwd: directory,
      provider,
      bootstrap,
      randomId: () => "fixed-id",
    })(pi.api)
    const ctx = createContext({ cwd: directory })
    await pi.emit("session_start", { reason: "startup" }, ctx)

    const calls: Array<[string, Record<string, unknown>]> = [
      ["read", { path: existing }],
      ["write", { path: newFile, content: "must not be written" }],
      [
        "edit",
        {
          path: existing,
          edits: [{ oldText: "unchanged", newText: "changed" }],
        },
      ],
      ["bash", { command: `touch ${shellMarker}` }],
      ["grep", { path: directory, pattern: "unchanged" }],
      ["find", { path: directory, pattern: "*.txt" }],
      ["ls", { path: directory }],
    ]
    for (const [toolName, params] of calls) {
      await expect(
        pi
          .tool(toolName)
          .execute(`${toolName}-closed`, params, undefined, undefined, ctx),
      ).rejects.toThrow(/not run on the host/)
    }

    const bashResult = (await pi.emit(
      "user_bash",
      {
        type: "user_bash",
        command: `touch ${shellMarker}`,
        excludeFromContext: false,
        cwd: directory,
      },
      ctx,
    )) as {
      result: { output: string; exitCode: number }
    }
    expect(bashResult.result.exitCode).toBe(1)
    expect(bashResult.result.output).toContain("not run on the host")
    expect(await readFile(existing, "utf8")).toBe("unchanged\n")
    await expect(readFile(newFile)).rejects.toThrow()
    await expect(readFile(shellMarker)).rejects.toThrow()
    expect(remote.kill).toHaveBeenCalledOnce()
    expect(remote.commandsRun).not.toHaveBeenCalled()
    expect(remote.filesRead).not.toHaveBeenCalled()
    expect(remote.filesWrite).not.toHaveBeenCalled()
  })

  it("omits host environment, maps host cwd, and caps command output and timeout", async () => {
    const remote = createSandboxHarness()
    const active: ActiveSandbox = {
      sandbox: remote.sandbox,
      binding: fakeBinding(),
      guestHome: GUEST_HOME,
    }
    const operations = createSandboxBashOperations(active, HOST_CWD)
    const output: string[] = []

    await operations.exec("env", `${HOST_CWD}/nested`, {
      onData: (data) => output.push(data.toString("utf8")),
      timeout: MAX_COMMAND_TIMEOUT_SECONDS + 10_000,
      env: { HOST_SECRET: "must-not-cross-boundary" },
    })

    const [command, options] = remote.commandsRun.mock.calls[0] ?? []
    expect(command).toBe("env")
    expect(options).toMatchObject({
      cwd: "/workspace/nested",
      timeoutMs: MAX_COMMAND_TIMEOUT_SECONDS * 1000,
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
    })
    expect(options).not.toHaveProperty("env")
    expect(output).toEqual(["remote stdout\nremote stderr\n"])

    remote.commandsRun.mockRejectedValueOnce(new TimeoutError())
    await expect(
      operations.exec("sleep forever", HOST_CWD, {
        onData: () => {},
        timeout: MAX_COMMAND_TIMEOUT_SECONDS + 1,
      }),
    ).rejects.toThrow(`timeout:${MAX_COMMAND_TIMEOUT_SECONDS}`)
  })

  it("passes bridge input through bounded environment data without shell interpolation", async () => {
    const remote = createSandboxHarness()
    const hostilePath = "/workspace/$(touch /tmp/escaped);'\"\nfile"

    await expect(
      callBridge<boolean>(remote.sandbox, "exists", { path: hostilePath }),
    ).resolves.toBe(true)

    expect(remote.bridgeRequests).toHaveLength(1)
    const request = remote.bridgeRequests[0]
    expect(request?.command).toBe(`node ${BRIDGE_PATH} exists`)
    expect(request?.command).not.toContain(hostilePath)
    expect(request?.input).toEqual({ path: hostilePath })
    expect(request?.options).toMatchObject({
      timeoutMs: 30_000,
      maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
    })
    expect(request?.options.env?.SUPERSERVE_PI_INPUT).not.toContain(hostilePath)
  })
})
