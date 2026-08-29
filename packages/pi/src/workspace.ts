import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { constants as fsConstants } from "node:fs"
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { callBridge, installBridge } from "./bridge.js"
import {
  GUEST_WORKSPACE,
  MAX_BRIDGE_OUTPUT_BYTES,
  MAX_SYNC_ARCHIVE_BYTES,
  MAX_SYNC_FILES,
  WORKSPACE_ARCHIVE_PATH,
} from "./constants.js"
import type {
  SandboxBootstrapOptions,
  SandboxBootstrapResult,
  SandboxHandle,
} from "./types.js"

const HOST_PROCESS_TIMEOUT_MS = 120_000
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024

interface ProcessResult {
  stdout: Buffer
  stderr: Buffer
  exitCode: number
}

export async function bootstrapSandbox(
  sandbox: SandboxHandle,
  options: SandboxBootstrapOptions,
): Promise<SandboxBootstrapResult> {
  await runRemoteSetup(
    sandbox,
    `mkdir -p -- ${GUEST_WORKSPACE}`,
    options.signal,
  )
  await installBridge(sandbox, options.signal)

  let syncedFiles = 0
  let syncedBytes = 0
  if (options.uploadWorkspace && options.sync === "tracked") {
    const synced = await uploadTrackedWorkspace(
      sandbox,
      options.localCwd,
      options.signal,
    )
    syncedFiles = synced.fileCount
    syncedBytes = synced.totalBytes
  }

  const guestHome = await callBridge<string>(
    sandbox,
    "home",
    {},
    options.signal,
  )
  return { guestHome, syncedFiles, syncedBytes }
}

async function uploadTrackedWorkspace(
  sandbox: SandboxHandle,
  localCwd: string,
  signal?: AbortSignal,
): Promise<{ fileCount: number; totalBytes: number }> {
  const files = await listTrackedFiles(localCwd, signal)
  let totalBytes = 0
  const archiveFiles: string[] = []

  for (const file of files) {
    let info
    try {
      info = await lstat(path.join(localCwd, file))
    } catch {
      continue
    }
    if (!info.isFile() && !info.isSymbolicLink()) continue
    totalBytes += info.size
    if (totalBytes > MAX_SYNC_ARCHIVE_BYTES) {
      throw new Error(
        `Tracked workspace exceeds the ${formatBytes(MAX_SYNC_ARCHIVE_BYTES)} upload limit. Use --superserve-sync none or reduce the checkout.`,
      )
    }
    archiveFiles.push(file)
  }

  if (archiveFiles.length === 0) {
    return { fileCount: 0, totalBytes: 0 }
  }

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "superserve-pi-"),
  )
  const archivePath = path.join(temporaryDirectory, "workspace.tar.gz")
  try {
    const tarInput = Buffer.from(`${archiveFiles.join("\0")}\0`)
    const result = await runProcess(
      "tar",
      ["-czf", archivePath, "--null", "-T", "-"],
      {
        cwd: localCwd,
        input: tarInput,
        signal,
        maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
      },
    )
    if (result.exitCode !== 0) {
      throw new Error(
        `Could not archive the tracked workspace: ${result.stderr.toString("utf8").trim() || `tar exited with ${result.exitCode}`}`,
      )
    }

    const archiveInfo = await stat(archivePath)
    if (archiveInfo.size > MAX_SYNC_ARCHIVE_BYTES) {
      throw new Error(
        `Workspace archive exceeds the ${formatBytes(MAX_SYNC_ARCHIVE_BYTES)} upload limit.`,
      )
    }
    const archive = await readFile(archivePath)
    await sandbox.files.write(WORKSPACE_ARCHIVE_PATH, archive, {
      timeoutMs: HOST_PROCESS_TIMEOUT_MS,
      signal,
    })
    await runRemoteSetup(
      sandbox,
      [
        `tar -xzf ${WORKSPACE_ARCHIVE_PATH} -C ${GUEST_WORKSPACE}`,
        `rm -f -- ${WORKSPACE_ARCHIVE_PATH}`,
      ].join(" && "),
      signal,
    )
    await initializeRemoteGit(sandbox, signal)
    return { fileCount: archiveFiles.length, totalBytes }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function listTrackedFiles(
  cwd: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await runProcess(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "ls-files",
      "-z",
      "--cached",
    ],
    { cwd, signal, maxOutputBytes: MAX_GIT_OUTPUT_BYTES },
  )
  if (result.exitCode !== 0) {
    throw new Error(
      "Tracked workspace sync requires a Git checkout. Use --superserve-sync none for an empty or pre-populated sandbox.",
    )
  }

  const files = result.stdout
    .toString("utf8")
    .split("\0")
    .filter((file) => file.length > 0)
  if (files.length > MAX_SYNC_FILES) {
    throw new Error(
      `Tracked workspace has ${files.length} files, exceeding the ${MAX_SYNC_FILES} file upload limit. Use --superserve-sync none or reduce the checkout.`,
    )
  }
  return files
}

async function initializeRemoteGit(
  sandbox: SandboxHandle,
  signal?: AbortSignal,
): Promise<void> {
  const command = [
    "command -v git >/dev/null 2>&1 || exit 0",
    `cd ${GUEST_WORKSPACE}`,
    "git init -q",
    'git config user.name "Superserve Pi"',
    'git config user.email "pi@superserve.local"',
    "git add -A",
    'git commit -qm "Initial workspace snapshot"',
  ].join(" && ")
  await runRemoteSetup(sandbox, command, signal)
}

async function runRemoteSetup(
  sandbox: SandboxHandle,
  command: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = await sandbox.commands.run(command, {
    timeoutMs: HOST_PROCESS_TIMEOUT_MS,
    signal,
    maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
  })
  if (result.exitCode !== 0) {
    const output = result.stderr.trim() || result.stdout.trim()
    throw new Error(
      `Superserve workspace setup failed: ${output || `command exited with ${result.exitCode}`}`,
    )
  }
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string
    input?: Buffer
    signal?: AbortSignal
    maxOutputBytes: number
  },
): Promise<ProcessResult> {
  if (options.signal?.aborted) throw new Error("Operation aborted")
  const trusted = await resolveTrustedExecutable(command, options.cwd)

  return new Promise((resolve, reject) => {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith("GIT_") &&
          key !== "TAR_OPTIONS" &&
          key.toUpperCase() !== "PATH",
      ),
    )
    environment.GIT_CONFIG_GLOBAL = "/dev/null"
    environment.GIT_CONFIG_NOSYSTEM = "1"
    environment.GIT_OPTIONAL_LOCKS = "0"
    environment.PATH = trusted.path

    const child = spawn(trusted.executable, args, {
      cwd: options.cwd,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      callback()
    }
    const stop = (error: Error) => {
      child.kill("SIGKILL")
      finish(() => reject(error))
    }
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > options.maxOutputBytes) {
        stop(new Error(`${command} output exceeded the safe limit`))
        return
      }
      target.push(chunk)
    }
    const onAbort = () => stop(new Error("Operation aborted"))
    const timer = setTimeout(
      () => stop(new Error(`${command} timed out`)),
      HOST_PROCESS_TIMEOUT_MS,
    )

    options.signal?.addEventListener("abort", onAbort, { once: true })
    if (options.signal?.aborted) {
      onAbort()
      return
    }
    child.stdout.on("data", collect(stdout))
    child.stderr.on("data", collect(stderr))
    child.on("error", (error) => finish(() => reject(error)))
    child.on("close", (code) =>
      finish(() =>
        resolve({
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          exitCode: code ?? 1,
        }),
      ),
    )
    child.stdin.on("error", () => {})
    child.stdin.end(options.input)
  })
}

async function resolveTrustedExecutable(
  command: string,
  cwd: string,
): Promise<{ executable: string; path: string }> {
  const workspaceRoot = await realpath(cwd)
  const searchPath = process.env.PATH ?? "/usr/bin:/bin"
  const directories: string[] = []

  for (const entry of searchPath.split(path.delimiter)) {
    const candidateDirectory = path.resolve(cwd, entry || ".")
    let resolvedDirectory: string
    try {
      resolvedDirectory = await realpath(candidateDirectory)
      if (!(await stat(resolvedDirectory)).isDirectory()) continue
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") {
        continue
      }
      throw error
    }

    const relative = path.relative(workspaceRoot, resolvedDirectory)
    const insideWorkspace =
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    if (!insideWorkspace && !directories.includes(resolvedDirectory)) {
      directories.push(resolvedDirectory)
    }
  }

  const suffixes =
    process.platform === "win32" && path.extname(command) === ""
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(path.delimiter)
          .filter(Boolean)
      : [""]
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = path.join(directory, `${command}${suffix}`)
      try {
        await access(candidate, fsConstants.X_OK)
        if (!(await stat(candidate)).isFile()) continue
        return {
          executable: await realpath(candidate),
          path: directories.join(path.delimiter),
        }
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") {
          continue
        }
        throw error
      }
    }
  }

  throw new Error(
    `Could not find trusted host executable ${command}; workspace-controlled PATH entries are excluded`,
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`
}
