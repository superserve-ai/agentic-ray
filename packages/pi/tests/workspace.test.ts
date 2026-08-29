import { Buffer } from "node:buffer"
import { execFile } from "node:child_process"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BridgeError, callBridge, installBridge } from "../src/bridge.js"
import {
  BRIDGE_PATH,
  GUEST_WORKSPACE,
  MAX_BRIDGE_OUTPUT_BYTES,
  MAX_WORKSPACE_DOWNLOAD_BYTES,
  WORKSPACE_ARCHIVE_PATH,
} from "../src/constants.js"
import { SandboxLifecycle } from "../src/lifecycle.js"
import type {
  SandboxBootstrap,
  SandboxHandle,
  SandboxProvider,
} from "../src/types.js"
import { bootstrapSandbox } from "../src/workspace.js"

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

interface CommandOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  maxOutputBytes?: number
}

interface FileWriteOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

interface CapturedWrite {
  path: string
  content: unknown
  options: FileWriteOptions
}

interface SandboxHarness {
  sandbox: SandboxHandle
  commandsRun: ReturnType<typeof vi.fn>
  downloadDir: ReturnType<typeof vi.fn>
  fileWrites: CapturedWrite[]
  filesWrite: ReturnType<typeof vi.fn>
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function createSandboxHarness(
  bridgeValues: Partial<Record<string, unknown>> = {},
): SandboxHarness {
  const fileWrites: CapturedWrite[] = []
  const commandsRun = vi.fn(
    async (command: string, _options: CommandOptions = {}) => {
      if (command.startsWith(`node ${BRIDGE_PATH} `)) {
        const action = command.slice(`node ${BRIDGE_PATH} `.length)
        return {
          stdout: JSON.stringify({
            ok: true,
            value:
              action in bridgeValues
                ? bridgeValues[action]
                : action === "home"
                  ? "/home/sandbox"
                  : true,
          }),
          stderr: "",
          exitCode: 0,
        }
      }
      return { stdout: "", stderr: "", exitCode: 0 }
    },
  )
  const filesWrite = vi.fn(
    async (
      filePath: string,
      content: unknown,
      options: FileWriteOptions = {},
    ) => {
      fileWrites.push({ path: filePath, content, options })
    },
  )
  const downloadDir = vi.fn(async () => new Uint8Array())
  const sandbox = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "workspace-test",
    status: "active",
    metadata: {},
    commands: { run: commandsRun } as unknown as SandboxHandle["commands"],
    files: {
      write: filesWrite,
      downloadDir,
    } as unknown as SandboxHandle["files"],
    getInfo: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
  } satisfies SandboxHandle

  return { sandbox, commandsRun, downloadDir, fileWrites, filesWrite }
}

describe("filesystem bridge safety", () => {
  it("keeps hostile input out of the fixed bridge command", async () => {
    const remote = createSandboxHarness({ exists: true })
    const hostilePath =
      "/workspace/quotes-'\"/line\n$(touch PWNED);*.{js,ts}?[abc]"

    await expect(
      callBridge<boolean>(remote.sandbox, "exists", { path: hostilePath }),
    ).resolves.toBe(true)

    expect(remote.commandsRun).toHaveBeenCalledTimes(1)
    const [command, options] = remote.commandsRun.mock.calls[0] ?? []
    expect(command).toBe(`node ${BRIDGE_PATH} exists`)
    expect(command).not.toContain(hostilePath)
    expect(command).not.toContain("$(touch PWNED)")
    expect(options).toMatchObject({
      timeoutMs: 30_000,
      maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
    })

    const encoded = options?.env?.SUPERSERVE_PI_INPUT
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encoded).not.toContain(hostilePath)
    expect(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    ).toEqual({ path: hostilePath })
  })

  it("rejects oversized bridge input before invoking the sandbox", async () => {
    const remote = createSandboxHarness()

    await expect(
      callBridge(remote.sandbox, "exists", { path: "x".repeat(64 * 1024) }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BridgeError>>({
        name: "BridgeError",
        message: "Remote filesystem request is too large",
      }),
    )
    expect(remote.commandsRun).not.toHaveBeenCalled()
  })

  it("installs the fixed bridge source with a bounded upload", async () => {
    const remote = createSandboxHarness()
    const controller = new AbortController()

    await installBridge(remote.sandbox, controller.signal)

    expect(remote.filesWrite).toHaveBeenCalledTimes(1)
    const write = remote.fileWrites[0]
    expect(write?.path).toBe(BRIDGE_PATH)
    expect(write?.content).toEqual(expect.any(String))
    expect(write?.content).toContain('process.env.SUPERSERVE_PI_INPUT || "e30"')
    expect(write?.content).toContain('Buffer.from(encoded, "base64url")')
    expect(write?.options).toEqual({
      timeoutMs: 30_000,
      signal: controller.signal,
    })
  })

  it("streams an offset range from a text file larger than the SDK read cap", async () => {
    const remote = createSandboxHarness()
    const directory = await makeTemporaryDirectory("superserve-pi-bridge-read-")
    const bridgePath = await materializeBridge(remote, directory)
    const filePath = path.join(directory, "large.txt")
    const line = "0123456789abcdefghi"
    await writeFile(filePath, `${line}\n`.repeat(600_000))
    expect((await stat(filePath)).size).toBeGreaterThan(10 * 1024 * 1024)

    const response = await runInstalledBridge<{
      kind: string
      content: string
      contentLimitReached: boolean
      firstLineBytes: number
      selectedLines: number
      totalLines: number
    }>(bridgePath, "read", {
      path: filePath,
      offset: 550_000,
      limit: 2,
    })

    expect(response).toEqual({
      kind: "text",
      content: `${line}\n${line}`,
      contentLimitReached: false,
      firstLineBytes: Buffer.byteLength(line),
      selectedLines: 2,
      totalLines: 600_001,
    })
  })

  it("keeps grep and find responses valid below the bridge transport cap", async () => {
    const remote = createSandboxHarness()
    const directory = await makeTemporaryDirectory("superserve-pi-bridge-cap-")
    const bridgePath = await materializeBridge(remote, directory)
    const grepPath = path.join(directory, "matches.txt")
    await writeFile(grepPath, `needle ${"x".repeat(1_990)}\n`.repeat(1_000))

    const grep = await runInstalledBridge<{
      output: string
      responseLimitReached: boolean
    }>(
      bridgePath,
      "grep",
      {
        path: grepPath,
        pattern: "needle",
        limit: 1_000,
        maxLineLength: 2_000,
      },
      (stdout) => {
        expect(Buffer.byteLength(stdout)).toBeLessThan(MAX_BRIDGE_OUTPUT_BYTES)
      },
    )
    expect(grep.responseLimitReached).toBe(true)
    expect(Buffer.byteLength(grep.output)).toBeLessThan(MAX_BRIDGE_OUTPUT_BYTES)

    let nested = directory
    for (let index = 0; index < 3; index += 1) {
      nested = path.join(nested, `${index}-${"d".repeat(230)}`)
      await mkdir(nested)
    }
    for (let start = 0; start < 1_100; start += 100) {
      await Promise.all(
        Array.from({ length: 100 }, (_, index) => {
          const number = String(start + index).padStart(4, "0")
          return writeFile(
            path.join(nested, `${number}-${"f".repeat(190)}.txt`),
            "",
          )
        }),
      )
    }
    const found = await runInstalledBridge<string[]>(
      bridgePath,
      "glob",
      { path: nested, pattern: "*.txt", limit: 5_000 },
      (stdout) => {
        expect(Buffer.byteLength(stdout)).toBeLessThan(MAX_BRIDGE_OUTPUT_BYTES)
      },
    )
    expect(found.length).toBeGreaterThan(0)
    expect(found.length).toBeLessThan(1_100)
    expect(found.every((entry) => typeof entry === "string")).toBe(true)

    const listed = await runInstalledBridge<{
      entries: Array<{ name: string; isDirectory: boolean }>
    }>(bridgePath, "list", { path: nested, limit: 11 })
    expect(listed.entries).toHaveLength(11)
    expect(listed.entries.map((entry) => entry.name)).toEqual(
      [...listed.entries]
        .map((entry) => entry.name)
        .toSorted((left, right) =>
          left.toLowerCase().localeCompare(right.toLowerCase()),
        ),
    )
  })
})

describe("workspace bootstrap", () => {
  it("installs the bridge without reading the host workspace when sync is disabled", async () => {
    const remote = createSandboxHarness({ home: "/home/remote" })

    await expect(
      bootstrapSandbox(remote.sandbox, {
        localCwd: "/host/path/that/must/not/be-used",
        sync: "none",
        uploadWorkspace: true,
      }),
    ).resolves.toEqual({
      guestHome: "/home/remote",
      syncedFiles: 0,
      syncedBytes: 0,
    })

    expect(remote.filesWrite).toHaveBeenCalledTimes(1)
    expect(remote.fileWrites[0]?.path).toBe(BRIDGE_PATH)
    expect(remote.commandsRun).toHaveBeenCalledTimes(2)
    expect(remote.commandsRun.mock.calls[0]?.[0]).toBe(
      `mkdir -p -- ${GUEST_WORKSPACE}`,
    )
    expect(remote.commandsRun.mock.calls[0]?.[1]).toMatchObject({
      timeoutMs: 120_000,
      maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
    })
    expect(remote.commandsRun.mock.calls[1]?.[0]).toBe(
      `node ${BRIDGE_PATH} home`,
    )
  })

  it("uploads dirty tracked files while excluding untracked files", async () => {
    const repository = await makeTemporaryDirectory("superserve-pi-repo-")
    await execFileAsync("git", ["init", "-q"], { cwd: repository })
    await mkdir(path.join(repository, "nested"))

    const trackedName = "tracked.txt"
    const hostileName = "nested/line\n$(touch PWNED)-*.txt"
    const untrackedName = "untracked-secret.txt"
    await writeFile(path.join(repository, trackedName), "staged version\n")
    await writeFile(path.join(repository, hostileName), "hostile filename\n")
    await execFileAsync("git", ["add", "--", trackedName, hostileName], {
      cwd: repository,
    })
    const dirtyContent = "dirty working tree version\n"
    await writeFile(path.join(repository, trackedName), dirtyContent)
    await writeFile(path.join(repository, untrackedName), "host secret\n")

    const remote = createSandboxHarness({ home: "/home/remote" })
    const result = await bootstrapSandbox(remote.sandbox, {
      localCwd: repository,
      sync: "tracked",
      uploadWorkspace: true,
    })

    expect(result).toEqual({
      guestHome: "/home/remote",
      syncedFiles: 2,
      syncedBytes:
        Buffer.byteLength(dirtyContent) +
        Buffer.byteLength("hostile filename\n"),
    })

    const archiveWrite = remote.fileWrites.find(
      (write) => write.path === WORKSPACE_ARCHIVE_PATH,
    )
    expect(archiveWrite?.content).toBeInstanceOf(Uint8Array)
    expect(archiveWrite?.options).toMatchObject({ timeoutMs: 120_000 })

    const commands = remote.commandsRun.mock.calls.map(([command]) => command)
    expect(commands).toContain(
      `tar -xzf ${WORKSPACE_ARCHIVE_PATH} -C ${GUEST_WORKSPACE} && rm -f -- ${WORKSPACE_ARCHIVE_PATH}`,
    )
    expect(commands).toContain(
      [
        "command -v git >/dev/null 2>&1 || exit 0",
        `cd ${GUEST_WORKSPACE}`,
        "git init -q",
        'git config user.name "Superserve Pi"',
        'git config user.email "pi@superserve.local"',
        "git add -A",
        'git commit -qm "Initial workspace snapshot"',
      ].join(" && "),
    )
    for (const command of commands) {
      expect(command).not.toContain(repository)
      expect(command).not.toContain(hostileName)
      expect(command).not.toContain(untrackedName)
    }
    for (const [, options] of remote.commandsRun.mock.calls) {
      expect(options).toMatchObject({
        maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
      })
    }

    const archivePath = path.join(repository, "captured-workspace.tar.gz")
    const extracted = path.join(repository, "extracted")
    await writeFile(archivePath, archiveWrite?.content as Uint8Array)
    await mkdir(extracted)
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extracted])

    await expect(
      readFile(path.join(extracted, trackedName), "utf8"),
    ).resolves.toBe(dirtyContent)
    await expect(
      readFile(path.join(extracted, hostileName), "utf8"),
    ).resolves.toBe("hostile filename\n")
    await expect(lstat(path.join(extracted, untrackedName))).rejects.toThrow()
    await expect(lstat(path.join(repository, "PWNED"))).rejects.toThrow()
  })

  it.each(["git", "tar"])(
    "never executes a workspace-controlled %s from PATH",
    async (executable) => {
      const repository = await makeTemporaryDirectory(
        "superserve-pi-path-repo-",
      )
      await execFileAsync("git", ["init", "-q"], { cwd: repository })
      await writeFile(path.join(repository, "tracked.txt"), "tracked\n")
      await execFileAsync("git", ["add", "--", "tracked.txt"], {
        cwd: repository,
      })

      const binDirectory = path.join(repository, "repo-bin")
      const marker = path.join(repository, `${executable}-executed`)
      await mkdir(binDirectory)
      const fakeExecutable = path.join(binDirectory, executable)
      await writeFile(
        fakeExecutable,
        `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 99\n`,
      )
      await chmod(fakeExecutable, 0o700)
      vi.stubEnv("PATH", `${binDirectory}${path.delimiter}${process.env.PATH}`)

      const remote = createSandboxHarness({ home: "/home/remote" })
      await expect(
        bootstrapSandbox(remote.sandbox, {
          localCwd: repository,
          sync: "tracked",
          uploadWorkspace: true,
        }),
      ).resolves.toMatchObject({ syncedFiles: 1 })

      await expect(lstat(marker)).rejects.toThrow()
    },
  )
})

describe("workspace download", () => {
  it("downloads with a hard byte cap and creates a private output file", async () => {
    const localCwd = await makeTemporaryDirectory("superserve-pi-download-")
    const remote = createSandboxHarness()
    const archive = Buffer.from("PK\u0003\u0004test archive")
    remote.downloadDir.mockResolvedValueOnce(archive)

    const provider = {
      create: vi.fn(),
      connect: vi.fn(async () => remote.sandbox),
      list: vi.fn(async () => []),
      killById: vi.fn(),
    } as unknown as SandboxProvider
    const bootstrap = vi.fn<SandboxBootstrap>(async () => ({
      guestHome: "/home/remote",
      syncedFiles: 0,
      syncedBytes: 0,
    }))
    const appended: Array<{ customType: string; data: unknown }> = []
    const pi = {
      appendEntry: (customType: string, data: unknown) => {
        appended.push({ customType, data })
      },
      getFlag: () => undefined,
      setActiveTools: vi.fn(),
    } as unknown as ExtensionAPI
    const controller = new AbortController()
    const ctx = {
      cwd: localCwd,
      hasUI: false,
      signal: controller.signal,
      sessionManager: {
        getBranch: () => [],
        getSessionFile: () => "/tmp/pi-session.jsonl",
        getSessionId: () => "session-download",
      },
      ui: {},
    } as unknown as ExtensionContext
    const lifecycle = new SandboxLifecycle(pi, localCwd, {
      provider,
      bootstrap,
      randomId: vi
        .fn()
        .mockReturnValueOnce("client-download")
        .mockReturnValueOnce("binding-download"),
    })
    await lifecycle.connect(remote.sandbox.id, ctx)

    const result = await lifecycle.downloadWorkspace("workspace.zip", ctx)

    const outputPath = path.join(localCwd, "workspace.zip")
    expect(result).toEqual({ path: outputPath, bytes: archive.byteLength })
    expect(remote.downloadDir).toHaveBeenCalledWith(GUEST_WORKSPACE, {
      timeoutMs: 300_000,
      signal: controller.signal,
      maxBytes: MAX_WORKSPACE_DOWNLOAD_BYTES,
    })
    await expect(readFile(outputPath)).resolves.toEqual(archive)
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600)
    expect(appended.length).toBeGreaterThan(0)
  })
})

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function materializeBridge(
  remote: SandboxHarness,
  directory: string,
): Promise<string> {
  await installBridge(remote.sandbox)
  const source = remote.fileWrites.find(
    (write) => write.path === BRIDGE_PATH,
  )?.content
  if (typeof source !== "string") throw new Error("Bridge source not captured")
  const bridgePath = path.join(directory, "bridge.mjs")
  await writeFile(bridgePath, source)
  return bridgePath
}

async function runInstalledBridge<T>(
  bridgePath: string,
  action: string,
  input: Record<string, unknown>,
  inspectStdout?: (stdout: string) => void,
): Promise<T> {
  const encoded = Buffer.from(JSON.stringify(input)).toString("base64url")
  const { stdout } = await execFileAsync(
    process.execPath,
    [bridgePath, action],
    {
      env: { SUPERSERVE_PI_INPUT: encoded },
      maxBuffer: MAX_BRIDGE_OUTPUT_BYTES + 1024,
    },
  )
  inspectStdout?.(stdout)
  const response = JSON.parse(stdout) as
    | { ok: true; value: T }
    | { ok: false; error: string }
  if (!response.ok) throw new Error(response.error)
  return response.value
}
