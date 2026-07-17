import { Buffer } from "node:buffer"

import {
  BRIDGE_PATH,
  MAX_BRIDGE_OUTPUT_BYTES,
  MAX_GREP_CONTEXT,
  MAX_GREP_RESULTS,
  MAX_LS_RESULTS,
} from "./constants.js"
import type { SandboxHandle } from "./types.js"

const MAX_BRIDGE_INPUT_BYTES = 64 * 1024

export type BridgeAction =
  | "access"
  | "exists"
  | "glob"
  | "grep"
  | "home"
  | "list"
  | "read"
  | "stat"

interface BridgeSuccess<T> {
  ok: true
  value: T
}

interface BridgeFailure {
  ok: false
  error: string
  code?: string
}

export interface BridgeListResult {
  exists: boolean
  isDirectory: boolean
  entries: Array<{ name: string; isDirectory: boolean }>
}

export interface BridgeGrepResult {
  output: string
  matchLimitReached: boolean
  linesTruncated: boolean
  responseLimitReached: boolean
}

export type BridgeReadResult =
  | {
      kind: "image"
      mimeType: string
      size: number
    }
  | {
      kind: "text"
      content: string
      contentLimitReached: boolean
      firstLineBytes: number
      selectedLines: number
      totalLines: number
    }

export class BridgeError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = "BridgeError"
    this.code = code
  }
}

export async function installBridge(
  sandbox: SandboxHandle,
  signal?: AbortSignal,
): Promise<void> {
  await sandbox.files.write(BRIDGE_PATH, BRIDGE_SOURCE, {
    timeoutMs: 30_000,
    signal,
  })
}

export async function callBridge<T>(
  sandbox: SandboxHandle,
  action: BridgeAction,
  input: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const encoded = Buffer.from(JSON.stringify(input)).toString("base64url")
  if (Buffer.byteLength(encoded) > MAX_BRIDGE_INPUT_BYTES) {
    throw new BridgeError("Remote filesystem request is too large")
  }

  const result = await sandbox.commands.run(`node ${BRIDGE_PATH} ${action}`, {
    env: { SUPERSERVE_PI_INPUT: encoded },
    timeoutMs: 30_000,
    signal,
    maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
  })
  if (result.exitCode !== 0) {
    const message =
      result.stderr.trim() || `bridge exited with ${result.exitCode}`
    throw new BridgeError(`Superserve filesystem bridge failed: ${message}`)
  }

  let response: unknown
  try {
    response = JSON.parse(result.stdout)
  } catch {
    throw new BridgeError("Superserve filesystem bridge returned invalid JSON")
  }
  if (!isBridgeResponse(response)) {
    throw new BridgeError(
      "Superserve filesystem bridge returned an invalid response",
    )
  }
  if (!response.ok) {
    throw new BridgeError(response.error, response.code)
  }
  return response.value as T
}

function isBridgeResponse(
  value: unknown,
): value is BridgeSuccess<unknown> | BridgeFailure {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false
  }
  const response = value as Record<string, unknown>
  if (response.ok === true) return "value" in response
  return response.ok === false && typeof response.error === "string"
}

const BRIDGE_SOURCE = String.raw`
import { createReadStream } from "node:fs"
import { access, lstat, open, opendir, readFile, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const action = process.argv[2]
const encoded = process.env.SUPERSERVE_PI_INPUT || "e30"
// The SDK cap includes the data plane's outer JSON envelope, which escapes this
// process's JSON stdout again. Keep the inner response well below half the cap.
const MAX_RESPONSE_BYTES = 768 * 1024
const MAX_SEARCH_VALUE_BYTES = 512 * 1024
const MAX_READ_CONTENT_BYTES = 64 * 1024
const MAX_READ_LINES = 2_001

function respond(value) {
  const response = JSON.stringify({ ok: true, value })
  if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) {
    throw new Error("Bridge response exceeds the safe output limit")
  }
  process.stdout.write(response)
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined
  process.stdout.write(JSON.stringify({ ok: false, error: message, code }))
}

function parseInput() {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
}

function requireString(input, key) {
  const value = input[key]
  if (typeof value !== "string") throw new Error("Invalid " + key)
  return value
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function matchesGlob(relativePath, pattern) {
  if (!pattern) return true
  if (pattern.includes("/")) {
    return path.matchesGlob(relativePath, pattern) ||
      path.matchesGlob(relativePath, "**/" + pattern)
  }
  return path.matchesGlob(path.posix.basename(relativePath), pattern)
}

function jsonValueBytes(value) {
  return Buffer.byteLength(JSON.stringify(value))
}

function appendUtf8Prefix(current, value, maxBytes) {
  if (maxBytes <= 0 || value.length === 0) return current
  const valueBuffer = Buffer.from(value)
  if (valueBuffer.length <= maxBytes) return current + value
  let end = maxBytes
  while (end > 0 && end < valueBuffer.length && (valueBuffer[end] & 0xc0) === 0x80) {
    end -= 1
  }
  return current + valueBuffer.subarray(0, end).toString("utf8")
}

function detectImageMimeType(prefix) {
  if (
    prefix.length >= 8 &&
    prefix[0] === 0x89 &&
    prefix.subarray(1, 4).toString("ascii") === "PNG" &&
    prefix[4] === 0x0d &&
    prefix[5] === 0x0a &&
    prefix[6] === 0x1a &&
    prefix[7] === 0x0a
  ) return "image/png"
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return "image/jpeg"
  }
  const signature = prefix.subarray(0, 6).toString("ascii")
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif"
  if (
    prefix.length >= 12 &&
    prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
    prefix.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp"
  if (prefix.length >= 2 && prefix[0] === 0x42 && prefix[1] === 0x4d) {
    return "image/bmp"
  }
  return undefined
}

async function inspectImage(targetPath) {
  const handle = await open(targetPath, "r")
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error("Path is not a regular file: " + targetPath)
    const prefix = Buffer.alloc(16)
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0)
    const mimeType = detectImageMimeType(prefix.subarray(0, bytesRead))
    return mimeType ? { mimeType, size: info.size } : undefined
  } finally {
    await handle.close()
  }
}

async function listEntries(targetPath, limit) {
  const selected = []
  const directory = await opendir(targetPath)
  for await (const entry of directory) {
    const item = { name: entry.name, isDirectory: entry.isDirectory() }
    let low = 0
    let high = selected.length
    while (low < high) {
      const middle = (low + high) >>> 1
      const comparison = selected[middle].name
        .toLowerCase()
        .localeCompare(item.name.toLowerCase())
      if (comparison <= 0) low = middle + 1
      else high = middle
    }
    selected.splice(low, 0, item)
    if (selected.length > limit) selected.pop()
  }
  return selected
}

async function runRead(input) {
  const targetPath = requireString(input, "path")
  const image = await inspectImage(targetPath)
  if (image) return { kind: "image", ...image }

  const offset = boundedInteger(input.offset, 1, 1, Number.MAX_SAFE_INTEGER)
  const requestedLimit = input.limit === undefined
    ? MAX_READ_LINES
    : boundedInteger(input.limit, 1, 1, MAX_READ_LINES)
  const selected = []
  let selectedBytes = 0
  let selectedLines = 0
  let totalLines = 0
  let currentLine = ""
  let currentLineBytes = 0
  let currentPreviewBytes = 0
  let currentPreviewComplete = true
  let contentLimitReached = false
  let firstLineBytes = 0
  let pendingCarriageReturn = false

  function appendSegment(segment) {
    const segmentBytes = Buffer.byteLength(segment)
    currentLineBytes += segmentBytes
    const lineNumber = totalLines + 1
    if (lineNumber < offset || selectedLines >= requestedLimit) return
    if (!currentPreviewComplete) return
    const separatorBytes = selectedLines > 0 ? 1 : 0
    const remaining = MAX_READ_CONTENT_BYTES - selectedBytes - separatorBytes - currentPreviewBytes
    const next = appendUtf8Prefix(currentLine, segment, remaining)
    const appendedBytes = Buffer.byteLength(next) - Buffer.byteLength(currentLine)
    currentPreviewBytes += appendedBytes
    currentLine = next
    if (appendedBytes < segmentBytes) {
      currentPreviewComplete = false
      contentLimitReached = true
    }
  }

  function finishLine() {
    totalLines += 1
    if (totalLines >= offset && selectedLines < requestedLimit) {
      if (selectedLines === 0) firstLineBytes = currentLineBytes
      const separatorBytes = selectedLines > 0 ? 1 : 0
      if (selectedBytes + separatorBytes + currentPreviewBytes <= MAX_READ_CONTENT_BYTES) {
        selected.push(currentLine)
        selectedBytes += separatorBytes + currentPreviewBytes
      } else {
        contentLimitReached = true
      }
      selectedLines += 1
    }
    currentLine = ""
    currentLineBytes = 0
    currentPreviewBytes = 0
    currentPreviewComplete = true
  }

  const stream = createReadStream(targetPath, { encoding: "utf8" })
  for await (const rawChunk of stream) {
    let chunk = (pendingCarriageReturn ? "\r" : "") + rawChunk
    pendingCarriageReturn = chunk.endsWith("\r")
    if (pendingCarriageReturn) chunk = chunk.slice(0, -1)
    const normalized = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const parts = normalized.split("\n")
    appendSegment(parts[0] || "")
    for (let index = 1; index < parts.length; index += 1) {
      finishLine()
      appendSegment(parts[index] || "")
    }
  }
  if (pendingCarriageReturn) finishLine()
  finishLine()

  return {
    kind: "text",
    content: selected.join("\n"),
    contentLimitReached,
    firstLineBytes,
    selectedLines,
    totalLines,
  }
}

async function walk(root, limit, visit) {
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory()) {
    await visit(root, path.posix.basename(root))
    return
  }

  let visited = 0
  async function walkDirectory(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (visited >= limit) return false
      if (entry.name === ".git" || entry.name === "node_modules") continue
      const absolutePath = path.posix.join(directory, entry.name)
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name
      if (entry.isDirectory()) {
        if (!(await walkDirectory(absolutePath, relativePath))) return false
        continue
      }
      visited += 1
      if (!(await visit(absolutePath, relativePath))) return false
    }
    return true
  }

  await walkDirectory(root, "")
}

function createMatcher(pattern, literal, ignoreCase) {
  if (literal) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle)
  }
  const expression = new RegExp(pattern, ignoreCase ? "i" : undefined)
  return (line) => expression.test(line)
}

async function runGrep(input) {
  const root = requireString(input, "path")
  const pattern = requireString(input, "pattern")
  const literal = input.literal === true
  const ignoreCase = input.ignoreCase === true
  const glob = typeof input.glob === "string" ? input.glob : undefined
  const context = boundedInteger(input.context, 0, 0, ${MAX_GREP_CONTEXT})
  const limit = boundedInteger(input.limit, 100, 1, ${MAX_GREP_RESULTS})
  const maxLineLength = boundedInteger(input.maxLineLength, 2_000, 80, 10_000)
  const matcher = createMatcher(pattern, literal, ignoreCase)
  const rootStat = await stat(root)
  const rootIsDirectory = rootStat.isDirectory()
  const output = []
  let outputValueBytes = 2
  let matchCount = 0
  let linesTruncated = false
  let responseLimitReached = false

  function appendOutput(line) {
    const lineBytes = jsonValueBytes(line) + (output.length > 0 ? 1 : 0)
    if (outputValueBytes + lineBytes > MAX_SEARCH_VALUE_BYTES) {
      responseLimitReached = true
      return false
    }
    output.push(line)
    outputValueBytes += lineBytes
    return true
  }

  await walk(root, 100_000, async (absolutePath, relativePath) => {
    if (matchCount >= limit || responseLimitReached) return false
    if (glob && !matchesGlob(relativePath, glob)) return true

    let content
    try {
      content = await readFile(absolutePath, "utf8")
    } catch {
      return true
    }
    if (content.includes("\0")) return true

    const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
    const displayPath = rootIsDirectory
      ? relativePath
      : path.posix.basename(absolutePath)
    for (let index = 0; index < lines.length; index += 1) {
      if (!matcher(lines[index] || "")) continue
      matchCount += 1
      const start = context > 0 ? Math.max(0, index - context) : index
      const end = context > 0 ? Math.min(lines.length - 1, index + context) : index
      for (let outputIndex = start; outputIndex <= end; outputIndex += 1) {
        const rawLine = (lines[outputIndex] || "").replace(/\r/g, "")
        const line = rawLine.length > maxLineLength
          ? rawLine.slice(0, maxLineLength)
          : rawLine
        if (line.length !== rawLine.length) linesTruncated = true
        const separator = outputIndex === index ? ":" : "-"
        if (!appendOutput(
          displayPath + separator + (outputIndex + 1) + separator + " " + line,
        )) return false
      }
      if (matchCount >= limit || responseLimitReached) return false
    }
    return true
  })

  return {
    output: output.join("\n"),
    matchLimitReached: matchCount >= limit,
    linesTruncated,
    responseLimitReached,
  }
}

async function main() {
  const input = parseInput()
  if (action === "home") {
    respond(homedir())
    return
  }

  const targetPath = requireString(input, "path")
  if (action === "access") {
    await access(targetPath)
    respond(null)
    return
  }
  if (action === "exists") {
    try {
      await access(targetPath)
      respond(true)
    } catch {
      respond(false)
    }
    return
  }
  if (action === "stat") {
    const info = await stat(targetPath)
    respond({ isDirectory: info.isDirectory() })
    return
  }
  if (action === "list") {
    try {
      const info = await stat(targetPath)
      if (!info.isDirectory()) {
        respond({ exists: true, isDirectory: false, entries: [] })
        return
      }
      const limit = boundedInteger(input.limit, 501, 1, ${MAX_LS_RESULTS + 1})
      respond({
        exists: true,
        isDirectory: true,
        entries: await listEntries(targetPath, limit),
      })
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        respond({ exists: false, isDirectory: false, entries: [] })
        return
      }
      throw error
    }
    return
  }
  if (action === "glob") {
    const pattern = requireString(input, "pattern")
    const limit = boundedInteger(input.limit, 1_000, 1, 5_000)
    const results = []
    let resultValueBytes = 2
    await walk(targetPath, 100_000, async (absolutePath, relativePath) => {
      if (matchesGlob(relativePath, pattern)) {
        const entryBytes = jsonValueBytes(absolutePath) + (results.length > 0 ? 1 : 0)
        if (resultValueBytes + entryBytes > MAX_SEARCH_VALUE_BYTES) return false
        results.push(absolutePath)
        resultValueBytes += entryBytes
      }
      return results.length < limit
    })
    respond(results)
    return
  }
  if (action === "grep") {
    respond(await runGrep(input))
    return
  }
  if (action === "read") {
    respond(await runRead(input))
    return
  }
  throw new Error("Unknown bridge action: " + action)
}

main().catch(fail)
`
