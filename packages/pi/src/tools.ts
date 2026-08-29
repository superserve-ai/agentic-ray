import { Buffer } from "node:buffer"
import path from "node:path"

import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateTail,
  type AgentToolResult,
  type BashOperations,
  type EditOperations,
  type ExtensionAPI,
  type ExtensionContext,
  type FindOperations,
  type GrepToolDetails,
  type GrepToolInput,
  type LsOperations,
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent"
import { TimeoutError } from "@superserve/sdk"

import {
  BridgeError,
  callBridge,
  type BridgeGrepResult,
  type BridgeListResult,
  type BridgeReadResult,
} from "./bridge.js"
import {
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
  GUEST_WORKSPACE,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_TIMEOUT_SECONDS,
  MAX_FILE_READ_BYTES,
  MAX_FIND_RESULTS,
  MAX_GREP_CONTEXT,
  MAX_GREP_RESULTS,
  MAX_LS_RESULTS,
} from "./constants.js"
import type { SandboxLifecycle } from "./lifecycle.js"
import type { ActiveSandbox } from "./types.js"

export function createSandboxToolRegistrar(
  pi: ExtensionAPI,
  lifecycle: SandboxLifecycle,
): () => void {
  let registered = false
  return () => {
    if (registered) return
    registerRead(pi, lifecycle)
    registerWrite(pi, lifecycle)
    registerEdit(pi, lifecycle)
    registerBash(pi, lifecycle)
    registerLs(pi, lifecycle)
    registerFind(pi, lifecycle)
    registerGrep(pi, lifecycle)
    registered = true
  }
}

export function createSandboxBashOperations(
  active: ActiveSandbox,
  localCwd: string,
): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      if (signal?.aborted) throw new Error("aborted")
      const timeoutSeconds = clampInteger(
        timeout,
        DEFAULT_COMMAND_TIMEOUT_SECONDS,
        1,
        MAX_COMMAND_TIMEOUT_SECONDS,
      )
      try {
        const result = await active.sandbox.commands.run(command, {
          cwd: mapAbsolutePath(cwd, localCwd, active.guestHome),
          timeoutMs: timeoutSeconds * 1000,
          signal,
          maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
        })
        if (signal?.aborted) throw new Error("aborted")
        const combined = result.stdout + result.stderr
        const notice =
          "\n\n[Superserve command output truncated to a bounded tail; full output was not written to the host.]"
        const bounded = truncateTail(combined, {
          maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(notice),
          maxLines: DEFAULT_MAX_LINES - 3,
        })
        const output = bounded.truncated
          ? `${bounded.content}${notice}`
          : combined
        if (output) onData(Buffer.from(output))
        return { exitCode: result.exitCode }
      } catch (error) {
        if (signal?.aborted) throw errorWithCause("aborted", error)
        if (error instanceof TimeoutError) {
          throw errorWithCause(`timeout:${timeoutSeconds}`, error)
        }
        throw error
      }
    },
  }
}

function registerRead(pi: ExtensionAPI, lifecycle: SandboxLifecycle): void {
  const local = createReadToolDefinition(GUEST_WORKSPACE)
  pi.registerTool({
    ...local,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await lifecycle.requireSandbox(ctx)
      return executeRemoteRead(
        active,
        ctx.cwd,
        rewritePathParameter(params, ctx.cwd, active.guestHome),
        signal,
        ctx,
      )
    },
  })
}

function registerWrite(pi: ExtensionAPI, lifecycle: SandboxLifecycle): void {
  const local = createWriteToolDefinition(GUEST_WORKSPACE)
  pi.registerTool({
    ...local,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await lifecycle.requireSandbox(ctx)
      const remote = createWriteToolDefinition(GUEST_WORKSPACE, {
        operations: createWriteOperations(active, ctx.cwd, signal),
      })
      return remote.execute(
        id,
        rewritePathParameter(params, ctx.cwd, active.guestHome),
        signal,
        onUpdate,
        ctx,
      )
    },
  })
}

function registerEdit(pi: ExtensionAPI, lifecycle: SandboxLifecycle): void {
  const local = createEditToolDefinition(GUEST_WORKSPACE)
  const { renderCall: _hostEditPreview, ...safeDefinition } = local
  pi.registerTool({
    ...safeDefinition,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await lifecycle.requireSandbox(ctx)
      const remote = createEditToolDefinition(GUEST_WORKSPACE, {
        operations: createEditOperations(active, ctx.cwd, signal),
      })
      return remote.execute(
        id,
        rewritePathParameter(params, ctx.cwd, active.guestHome),
        signal,
        onUpdate,
        ctx,
      )
    },
  })
}

function registerBash(pi: ExtensionAPI, lifecycle: SandboxLifecycle): void {
  const local = createBashToolDefinition(GUEST_WORKSPACE)
  pi.registerTool({
    ...local,
    description: `Execute a bash command in the Superserve sandbox working directory. The SDK response is capped at ${formatSize(MAX_COMMAND_OUTPUT_BYTES)}; responses over that cap fail safely. Successful output is limited to the last ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}, and no full-output copy is written to the host. Optionally provide a timeout in seconds.`,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await lifecycle.requireSandbox(ctx)
      const remote = createBashToolDefinition(GUEST_WORKSPACE, {
        operations: createSandboxBashOperations(active, ctx.cwd),
      })
      return remote.execute(
        id,
        {
          ...params,
          timeout: clampInteger(
            params.timeout,
            DEFAULT_COMMAND_TIMEOUT_SECONDS,
            1,
            MAX_COMMAND_TIMEOUT_SECONDS,
          ),
        },
        signal,
        onUpdate,
        ctx,
      )
    },
  })
}

function registerLs(pi: ExtensionAPI, lifecycle: SandboxLifecycle): void {
  const local = createLsToolDefinition(GUEST_WORKSPACE)
  pi.registerTool({
    ...local,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await lifecycle.requireSandbox(ctx)
      const limit = clampInteger(params.limit, 500, 1, MAX_LS_RESULTS)
      const remote = createLsToolDefinition(GUEST_WORKSPACE, {
        operations: createLsOperations(active, ctx.cwd, signal, limit + 1),
      })
      return remote.execute(
        id,
        {
          ...rewritePathParameter(params, ctx.cwd, active.guestHome),
          limit,
        },
        signal,
        onUpdate,
        ctx,
      )
    },
  })
}

function registerFind(pi: ExtensionAPI, lifecycle: SandboxLifecycle): void {
  const local = createFindToolDefinition(GUEST_WORKSPACE)
  pi.registerTool({
    ...local,
    description: `${local.description} In Superserve sandbox mode, .git and node_modules directories are excluded, but .gitignore rules are not evaluated.`,
    promptSnippet:
      "Find files by glob pattern (Superserve excludes .git/node_modules; it does not evaluate .gitignore)",
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await lifecycle.requireSandbox(ctx)
      const remote = createFindToolDefinition(GUEST_WORKSPACE, {
        operations: createFindOperations(active, ctx.cwd, signal),
      })
      return remote.execute(
        id,
        {
          ...rewritePathParameter(params, ctx.cwd, active.guestHome),
          limit: clampInteger(params.limit, 1_000, 1, MAX_FIND_RESULTS),
        },
        signal,
        onUpdate,
        ctx,
      )
    },
  })
}

function registerGrep(pi: ExtensionAPI, lifecycle: SandboxLifecycle): void {
  const local = createGrepToolDefinition(GUEST_WORKSPACE)
  pi.registerTool({
    ...local,
    description: `${local.description} In Superserve sandbox mode, .git and node_modules directories are excluded, but .gitignore rules are not evaluated.`,
    promptSnippet:
      "Search file contents (Superserve excludes .git/node_modules; it does not evaluate .gitignore)",
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await lifecycle.requireSandbox(ctx)
      return executeRemoteGrep(
        active,
        ctx.cwd,
        rewritePathParameter(params, ctx.cwd, active.guestHome),
        signal,
      )
    },
  })
}

function createReadOperations(
  active: ActiveSandbox,
  localCwd: string,
  signal?: AbortSignal,
): ReadOperations {
  return {
    readFile: async (filePath) =>
      Buffer.from(
        await active.sandbox.files.read(
          mapAbsolutePath(filePath, localCwd, active.guestHome),
          { maxBytes: MAX_FILE_READ_BYTES, signal },
        ),
      ),
    access: async (filePath) => {
      await callBridge(
        active.sandbox,
        "access",
        { path: mapAbsolutePath(filePath, localCwd, active.guestHome) },
        signal,
      )
    },
    detectImageMimeType: async (filePath) =>
      imageMimeType(mapAbsolutePath(filePath, localCwd, active.guestHome)),
  }
}

async function executeRemoteRead(
  active: ActiveSandbox,
  localCwd: string,
  params: ReadToolInput,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<ReadToolDetails | undefined>> {
  const offset = optionalPositiveInteger(params.offset, "offset") ?? 1
  const limit = optionalPositiveInteger(params.limit, "limit")
  const filePath = resolveGuestPath(params.path, localCwd, active.guestHome)
  const result = await callBridge<BridgeReadResult>(
    active.sandbox,
    "read",
    { path: filePath, offset, limit },
    signal,
  )
  validateBridgeReadResult(result)

  if (result.kind === "image") {
    if (result.size > MAX_FILE_READ_BYTES) {
      throw new Error(
        `Image is ${formatSize(result.size)}, exceeds ${formatSize(MAX_FILE_READ_BYTES)} remote read limit`,
      )
    }
    const buffer = Buffer.from(
      await active.sandbox.files.read(filePath, {
        maxBytes: MAX_FILE_READ_BYTES,
        signal,
      }),
    )
    const mimeType = detectSupportedImageMimeType(buffer)
    if (!mimeType || mimeType !== result.mimeType) {
      throw new Error("Remote image changed while it was being read")
    }
    let note = `Read image file [${mimeType}]`
    if (!ctx.model || !ctx.model.input.includes("image")) {
      note +=
        "\n[Current model does not support images. The image will be omitted from this request.]"
    }
    return {
      content: [
        { type: "text", text: note },
        { type: "image", data: buffer.toString("base64"), mimeType },
      ],
      details: undefined,
    }
  }

  if (offset > result.totalLines) {
    throw new Error(
      `Offset ${offset} is beyond end of file (${result.totalLines} lines total)`,
    )
  }

  const truncation = truncateHead(result.content)
  let outputText: string
  let details: ReadToolDetails | undefined
  if (result.firstLineBytes > DEFAULT_MAX_BYTES) {
    outputText = `[Line ${offset} is ${formatSize(result.firstLineBytes)}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${offset}p' ${params.path} | head -c ${DEFAULT_MAX_BYTES}]`
    details = { truncation }
  } else if (truncation.truncated || result.contentLimitReached) {
    const endLine = offset + truncation.outputLines - 1
    const nextOffset = endLine + 1
    const reason =
      truncation.truncatedBy === "lines"
        ? ""
        : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`
    outputText = `${truncation.content}\n\n[Showing lines ${offset}-${endLine} of ${result.totalLines}${reason}. Use offset=${nextOffset} to continue.]`
    details = { truncation }
  } else if (limit !== undefined && offset - 1 + limit < result.totalLines) {
    const remaining = result.totalLines - (offset - 1 + limit)
    outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${offset + limit} to continue.]`
  } else {
    outputText = truncation.content
  }

  return {
    content: [{ type: "text", text: outputText }],
    details,
  }
}

function createWriteOperations(
  active: ActiveSandbox,
  localCwd: string,
  signal?: AbortSignal,
): WriteOperations {
  return {
    writeFile: async (filePath, content) => {
      await active.sandbox.files.write(
        mapAbsolutePath(filePath, localCwd, active.guestHome),
        content,
        { signal },
      )
    },
    mkdir: async (directory) => {
      mapAbsolutePath(directory, localCwd, active.guestHome)
    },
  }
}

function createEditOperations(
  active: ActiveSandbox,
  localCwd: string,
  signal?: AbortSignal,
): EditOperations {
  const read = createReadOperations(active, localCwd, signal)
  const write = createWriteOperations(active, localCwd, signal)
  return {
    readFile: read.readFile,
    access: read.access,
    writeFile: write.writeFile,
  }
}

function createLsOperations(
  active: ActiveSandbox,
  localCwd: string,
  signal?: AbortSignal,
  entryLimit = 501,
): LsOperations {
  let cached: { root: string; result: BridgeListResult } | undefined

  const load = async (filePath: string) => {
    const guestPath = mapAbsolutePath(filePath, localCwd, active.guestHome)
    if (!cached) {
      cached = {
        root: guestPath,
        result: await callBridge<BridgeListResult>(
          active.sandbox,
          "list",
          { path: guestPath, limit: entryLimit },
          signal,
        ),
      }
    }
    return { guestPath, cached }
  }

  return {
    exists: async (filePath) => (await load(filePath)).cached.result.exists,
    stat: async (filePath) => {
      const loaded = await load(filePath)
      if (loaded.guestPath === loaded.cached.root) {
        return {
          isDirectory: () => loaded.cached.result.isDirectory,
        }
      }
      if (path.posix.dirname(loaded.guestPath) === loaded.cached.root) {
        const name = path.posix.basename(loaded.guestPath)
        const entry = loaded.cached.result.entries.find(
          (candidate) => candidate.name === name,
        )
        if (!entry) throw new BridgeError(`Path not found: ${loaded.guestPath}`)
        return { isDirectory: () => entry.isDirectory }
      }
      const result = await callBridge<{ isDirectory: boolean }>(
        active.sandbox,
        "stat",
        { path: loaded.guestPath },
        signal,
      )
      return { isDirectory: () => result.isDirectory }
    },
    readdir: async (directory) => {
      const loaded = await load(directory)
      return loaded.cached.result.entries.map((entry) => entry.name)
    },
  }
}

function createFindOperations(
  active: ActiveSandbox,
  localCwd: string,
  signal?: AbortSignal,
): FindOperations {
  return {
    exists: (filePath) =>
      callBridge<boolean>(
        active.sandbox,
        "exists",
        { path: mapAbsolutePath(filePath, localCwd, active.guestHome) },
        signal,
      ),
    glob: async (pattern, cwd, options) => {
      const results = await callBridge<unknown>(
        active.sandbox,
        "glob",
        {
          path: mapAbsolutePath(cwd, localCwd, active.guestHome),
          pattern,
          limit: clampInteger(options.limit, 1_000, 1, MAX_FIND_RESULTS),
        },
        signal,
      )
      if (
        !Array.isArray(results) ||
        !results.every((item) => typeof item === "string")
      ) {
        throw new BridgeError("Superserve find bridge returned invalid paths")
      }
      return results
    },
  }
}

async function executeRemoteGrep(
  active: ActiveSandbox,
  localCwd: string,
  params: GrepToolInput,
  signal?: AbortSignal,
) {
  const limit = clampInteger(params.limit, 100, 1, MAX_GREP_RESULTS)
  const context = clampInteger(params.context, 0, 0, MAX_GREP_CONTEXT)
  const searchPath = resolveGuestPath(
    params.path ?? ".",
    localCwd,
    active.guestHome,
  )
  const result = await callBridge<BridgeGrepResult>(
    active.sandbox,
    "grep",
    {
      path: searchPath,
      pattern: params.pattern,
      glob: params.glob,
      ignoreCase: params.ignoreCase,
      literal: params.literal,
      context,
      limit,
      maxLineLength: 2_000,
    },
    signal,
  )
  if (!result.output) {
    return {
      content: [{ type: "text" as const, text: "No matches found" }],
      details: undefined,
    }
  }

  const truncation = truncateHead(result.output, {
    maxLines: Number.MAX_SAFE_INTEGER,
  })
  const details: GrepToolDetails = {}
  const notices: string[] = []
  let output = truncation.content
  if (result.matchLimitReached) {
    details.matchLimitReached = limit
    notices.push(`${limit} matches limit reached`)
  }
  if (result.linesTruncated) {
    details.linesTruncated = true
    notices.push("long lines truncated")
  }
  if (truncation.truncated) {
    details.truncation = truncation
    notices.push(`${formatSize(truncation.maxBytes)} limit reached`)
  }
  if (result.responseLimitReached) {
    notices.push("remote response limit reached")
  }
  if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`
  return {
    content: [{ type: "text" as const, text: output }],
    details: Object.keys(details).length > 0 ? details : undefined,
  }
}

function rewritePathParameter<T extends { path?: string }>(
  params: T,
  localCwd: string,
  guestHome: string,
): T {
  if (typeof params.path !== "string") return params
  return {
    ...params,
    path: rewriteInputPath(params.path, localCwd, guestHome),
  }
}

function rewriteInputPath(
  input: string,
  localCwd: string,
  guestHome: string,
): string {
  const value = input.startsWith("@") ? input.slice(1) : input
  if (value === "~") return guestHome
  if (value.startsWith("~/")) return path.posix.join(guestHome, value.slice(2))
  if (!path.isAbsolute(value)) return toPosix(value)
  return mapAbsolutePath(value, localCwd, guestHome)
}

function resolveGuestPath(
  input: string,
  localCwd: string,
  guestHome: string,
): string {
  const rewritten = rewriteInputPath(input, localCwd, guestHome)
  return path.posix.isAbsolute(rewritten)
    ? path.posix.normalize(rewritten)
    : path.posix.resolve(GUEST_WORKSPACE, rewritten)
}

function mapAbsolutePath(
  filePath: string,
  localCwd: string,
  guestHome: string,
): string {
  const value = filePath.startsWith("@") ? filePath.slice(1) : filePath
  if (value === "~") return guestHome
  if (value.startsWith("~/")) return path.posix.join(guestHome, value.slice(2))
  const relative = path.relative(localCwd, value)
  if (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  ) {
    return relative
      ? path.posix.join(GUEST_WORKSPACE, toPosix(relative))
      : GUEST_WORKSPACE
  }
  return path.posix.normalize(toPosix(value))
}

function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep)
}

function imageMimeType(filePath: string): string | null {
  switch (path.posix.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".gif":
      return "image/gif"
    case ".webp":
      return "image/webp"
    case ".bmp":
      return "image/bmp"
    default:
      return null
  }
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value ?? fallback)))
}

function optionalPositiveInteger(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be a positive finite number`)
  }
  return Math.floor(value)
}

function validateBridgeReadResult(
  result: BridgeReadResult,
): asserts result is BridgeReadResult {
  if (!result || typeof result !== "object" || !("kind" in result)) {
    throw new BridgeError("Superserve read bridge returned an invalid result")
  }
  if (result.kind === "image") {
    if (
      typeof result.mimeType !== "string" ||
      !Number.isSafeInteger(result.size) ||
      result.size < 0
    ) {
      throw new BridgeError(
        "Superserve read bridge returned invalid image data",
      )
    }
    return
  }
  if (
    result.kind !== "text" ||
    typeof result.content !== "string" ||
    typeof result.contentLimitReached !== "boolean" ||
    !Number.isSafeInteger(result.firstLineBytes) ||
    result.firstLineBytes < 0 ||
    !Number.isSafeInteger(result.selectedLines) ||
    result.selectedLines < 0 ||
    !Number.isSafeInteger(result.totalLines) ||
    result.totalLines < 1
  ) {
    throw new BridgeError("Superserve read bridge returned invalid text data")
  }
}

function detectSupportedImageMimeType(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString("ascii") === "PNG" &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png"
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg"
  }
  const signature = buffer.subarray(0, 6).toString("ascii")
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif"
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp"
  }
  return undefined
}

function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message)
  ;(error as Error & { cause?: unknown }).cause = cause
  return error
}
