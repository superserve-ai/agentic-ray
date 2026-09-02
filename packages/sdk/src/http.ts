/**
 * Minimal HTTP client wrapping native `fetch`.
 *
 * Handles:
 * - Auth header injection (`X-API-Key`)
 * - JSON request/response serialization
 * - Error mapping to typed SDK errors
 * - Request timeout via AbortController
 * - SSE stream parsing for exec/stream endpoint
 * - Exponential-backoff retry on idempotent operations (GET/DELETE)
 */

import {
  mapApiError,
  SandboxError,
  TimeoutError,
  ValidationError,
} from "./errors.js"
import type { ApiExecStreamEvent } from "./types.js"

const DEFAULT_TIMEOUT_MS = 30_000

const SDK_VERSION = "0.8.3"
const USER_AGENT = `@superserve/sdk/${SDK_VERSION} (node/${
  typeof process !== "undefined" && process.versions?.node
    ? `v${process.versions.node}`
    : "unknown"
})`

// Retry tuning
const DEFAULT_MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 100
const MAX_BACKOFF_MS = 30_000
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

const DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2 GiB; matches boxd's server-side zip cap

interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE"
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
  /**
   * Cap the JSON response body read at this many bytes. Set it for endpoints
   * whose body is backed by untrusted sandbox output (e.g. the data-plane
   * `/exec`), which can be as large as the sandbox's RAM: the body is read with
   * a streaming cap and a `ValidationError` is thrown the moment it is exceeded,
   * instead of buffering the whole thing first. Omit for trusted, bounded
   * control-plane responses (the default — unchanged `res.text()` behavior).
   */
  maxBytes?: number
}

/**
 * Compose an internal controller signal with an optional user signal.
 * Uses AbortSignal.any when available.
 */
function composeSignals(
  internal: AbortSignal,
  user?: AbortSignal,
): AbortSignal {
  if (!user) return internal
  return AbortSignal.any([internal, user])
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse a Retry-After header value.
 * Returns milliseconds to wait, capped at MAX_BACKOFF_MS, or null if invalid.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Numeric seconds
  const asNumber = Number(trimmed)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(asNumber * 1000, MAX_BACKOFF_MS)
  }
  // HTTP-date
  const asDate = Date.parse(trimmed)
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now()
    if (delta <= 0) return 0
    return Math.min(delta, MAX_BACKOFF_MS)
  }
  return null
}

function backoffDelay(attempt: number): number {
  // Attempt 1 → 100ms, attempt 2 → 200ms, attempt 3 → 400ms, etc.
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1)
  const jitter = base * (0.8 + Math.random() * 0.4)
  return Math.min(jitter, MAX_BACKOFF_MS)
}

/**
 * Is this error a network-level transient error worth retrying?
 *
 * `fetch` throws a `TypeError` for network failures (connection refused,
 * DNS failure, reset, etc). AbortErrors should NOT be treated as network
 * errors — they're explicit cancellations.
 */
function isNetworkError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false
  if (err instanceof TypeError) return true
  // Node fetch sometimes surfaces errors with name "FetchError" or a cause
  if (
    err instanceof Error &&
    (err.name === "FetchError" || err.name === "NetworkError")
  ) {
    return true
  }
  return false
}

/**
 * Internal fetch wrapper with per-attempt timeout, abort-signal composition,
 * and optional retry on transient conditions (429, 5xx, network errors).
 *
 * Only retries when `opts.retryable` is true. Callers must ensure the
 * operation is idempotent before enabling retries.
 */
async function retryableFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  opts: {
    timeoutMs: number
    maxAttempts?: number
    retryable: boolean
    userSignal?: AbortSignal
  },
): Promise<Response> {
  const maxAttempts = opts.retryable
    ? (opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
    : 1

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, opts.timeoutMs)

    const signal = composeSignals(controller.signal, opts.userSignal)

    try {
      const res = await fetch(input, { ...init, signal })

      // Retry on specific 5xx / 429
      if (opts.retryable && RETRYABLE_STATUSES.has(res.status)) {
        if (attempt >= maxAttempts) {
          return res
        }
        let delay: number | null = null
        if (res.status === 429) {
          delay = parseRetryAfter(res.headers.get("Retry-After"))
        }
        if (delay === null) {
          delay = backoffDelay(attempt)
        }
        // Drain body so the connection can be released
        try {
          await res.arrayBuffer()
        } catch {
          // ignore
        }
        clearTimeout(timer)
        await sleep(delay)
        continue
      }

      return res
    } catch (err) {
      lastError = err

      // User cancellation propagates immediately, never retried
      if (opts.userSignal?.aborted) {
        throw err
      }

      // Internal timeout — surface as TimeoutError
      if (timedOut) {
        throw new TimeoutError(`Request timed out after ${opts.timeoutMs}ms`)
      }

      // Non-network / non-timeout aborts (rare): treat as cancellation
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err
      }

      // Retry network errors if retryable and attempts remain
      if (opts.retryable && isNetworkError(err) && attempt < maxAttempts) {
        await sleep(backoffDelay(attempt))
        continue
      }

      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  // Shouldn't be reachable — the loop either returns or throws
  throw lastError ?? new SandboxError("Request failed with no response")
}

async function readErrorBody(
  res: Response,
): Promise<{ error?: { code?: string; message?: string } }> {
  try {
    return (await res.json()) as { error?: { code?: string; message?: string } }
  } catch {
    return {}
  }
}

/**
 * Make an HTTP request and return parsed JSON.
 *
 * Throws typed SandboxError subclasses on non-2xx responses.
 *
 * Retries GET/DELETE on transient failures (429, 502/503/504, network errors).
 * POST/PATCH are never retried (not idempotent).
 */
export async function request<T>(opts: RequestOptions): Promise<T> {
  const {
    method,
    url,
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: userSignal,
    maxBytes,
  } = opts

  const retryable = method === "GET" || method === "DELETE"
  const mergedHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    ...headers,
  }

  try {
    const res = await retryableFetch(
      url,
      {
        method,
        headers: mergedHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      { timeoutMs, retryable, userSignal },
    )

    if (!res.ok) {
      const errorBody = await readErrorBody(res)
      throw mapApiError(res.status, errorBody)
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as T
    }

    // Untrusted (data-plane) endpoints: read the JSON body with a streaming
    // byte cap so a hostile sandbox can't make us buffer an unbounded response.
    if (maxBytes !== undefined) {
      const bytes = await readBodyWithLimit(res, maxBytes, "Response body")
      if (bytes.byteLength === 0) return undefined as T
      return JSON.parse(new TextDecoder().decode(bytes)) as T
    }

    // Some endpoints legally return 2xx with an empty body.
    const text = await res.text()
    return text ? (JSON.parse(text) as T) : (undefined as T)
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new SandboxError("Request aborted", undefined, undefined, {
        cause: err,
      })
    }
    throw new SandboxError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      { cause: err },
    )
  }
}

/**
 * Make a request that returns no body (204 expected).
 */
export async function requestVoid(opts: RequestOptions): Promise<void> {
  await request<void>(opts)
}

/**
 * Upload raw bytes to a URL. Used for file upload to the data plane.
 *
 * Not retried — POST is not idempotent.
 */
export async function uploadBytes(opts: {
  url: string
  headers: Record<string, string>
  body: BodyInit
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<void> {
  const {
    url,
    headers,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: userSignal,
  } = opts

  const mergedHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/octet-stream",
    ...headers,
  }

  try {
    const res = await retryableFetch(
      url,
      { method: "POST", headers: mergedHeaders, body },
      { timeoutMs, retryable: false, userSignal },
    )

    if (!res.ok) {
      const errorBody = await readErrorBody(res)
      throw mapApiError(res.status, errorBody)
    }
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new SandboxError("Upload aborted", undefined, undefined, {
        cause: err,
      })
    }
    throw new SandboxError(
      `Upload error: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      { cause: err },
    )
  }
}

/**
 * Read a response body into a single Uint8Array, refusing to buffer more than
 * `maxBytes`.
 *
 * The data plane is untrusted: a hostile sandbox can return a multi-GB or
 * endless response. Streaming the body lets us stop pulling bytes (and free the
 * connection) the moment the running total exceeds the cap, instead of
 * buffering the whole thing first.
 */
async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
  what = "Download",
): Promise<Uint8Array> {
  // No streaming body available (e.g. mocked responses) — fall back to a full
  // buffer read, then enforce the cap.
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > maxBytes) {
      throw new ValidationError(
        `${what} exceeds the maximum size of ${maxBytes} bytes`,
      )
    }
    return buf
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      total += value.byteLength
      if (total > maxBytes) {
        // Stop pulling bytes from the sandbox.
        await reader.cancel()
        throw new ValidationError(
          `${what} exceeds the maximum size of ${maxBytes} bytes`,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Download raw bytes from a URL. Used for file download from the data plane.
 *
 * Retries on transient failures (GET is idempotent).
 *
 * The response body is read with a byte cap (`maxBytes`, default 2 GiB) to
 * protect against a hostile data plane returning an unbounded response.
 */
export async function downloadBytes(opts: {
  url: string
  headers: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  maxBytes?: number
}): Promise<Uint8Array> {
  const {
    url,
    headers,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: userSignal,
    maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
  } = opts

  const mergedHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    ...headers,
  }

  try {
    const res = await retryableFetch(
      url,
      { method: "GET", headers: mergedHeaders },
      { timeoutMs, retryable: true, userSignal },
    )

    if (!res.ok) {
      const errorBody = await readErrorBody(res)
      throw mapApiError(res.status, errorBody)
    }

    return await readBodyWithLimit(res, maxBytes)
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new SandboxError("Download aborted", undefined, undefined, {
        cause: err,
      })
    }
    throw new SandboxError(
      `Download error: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      { cause: err },
    )
  }
}

/**
 * Consume an SSE stream from the exec/stream endpoint.
 *
 * Calls `onEvent` for each parsed event. Returns when the stream ends
 * (server sends `finished: true` or closes the connection).
 *
 * The timeout is an idle timeout — it resets each time a chunk is received,
 * so long-running commands won't spuriously abort.
 *
 * Not retried — POST is not idempotent.
 */
export async function streamSSE<TEvent = ApiExecStreamEvent>(opts: {
  url: string
  headers: Record<string, string>
  body?: unknown
  method?: "GET" | "POST"
  timeoutMs?: number
  signal?: AbortSignal
  onEvent: (event: TEvent) => void
}): Promise<void> {
  const {
    url,
    headers,
    body,
    method = "POST",
    timeoutMs = 300_000,
    signal: userSignal,
    onEvent,
  } = opts
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const signal = composeSignals(controller.signal, userSignal)

  try {
    const init: RequestInit = {
      method,
      headers: {
        "User-Agent": USER_AGENT,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      signal,
    }
    if (method === "POST") {
      init.body = JSON.stringify(body ?? {})
    }

    const res = await fetch(url, init)

    if (!res.ok) {
      const errorBody = await readErrorBody(res)
      throw mapApiError(res.status, errorBody)
    }

    if (!res.body) {
      throw new SandboxError("Expected streaming response but got empty body")
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Reset the idle timer on each chunk received
      if (timer) {
        clearTimeout(timer)
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        // SSE spec: `data:` with optional leading space on the value.
        if (!line.startsWith("data:")) continue
        const json = line.slice(5).trim()
        if (!json || json === "[DONE]") continue
        try {
          const event = JSON.parse(json) as TEvent
          onEvent(event)
        } catch {
          // Skip malformed events
        }
      }
    }
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      if (timedOut)
        throw new TimeoutError(`Stream timed out after ${timeoutMs}ms`)
      throw new SandboxError("Stream aborted", undefined, undefined, {
        cause: err,
      })
    }
    throw new SandboxError(
      `Stream error: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      { cause: err },
    )
  } finally {
    if (timer) clearTimeout(timer)
  }
}
