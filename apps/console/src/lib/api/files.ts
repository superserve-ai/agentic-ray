/**
 * files — data-plane file operations for the sandbox file manager.
 *
 * Byte transfer (read/write/upload/download) talks directly to the per-sandbox
 * data plane (`boxd-{id}.{host}/files`, host per the sandbox's region) with
 * the `X-Access-Token`.
 * Directory listing is metadata, so it goes through the control-plane API
 * (`apiClient`) instead — see `listDir`.
 *
 * Pure helpers (path math, header parsing) live here too so the UI and tests
 * share one implementation.
 */

import { apiClient } from "@/lib/api/client"
import type { SandboxResponse } from "@/lib/api/types"
import { sandboxHostFor } from "@/lib/sandbox-host"

/** A single entry in a directory listing. */
export interface DirEntry {
  name: string
  is_dir: boolean
  size: number
  /** Unix seconds; 0 on sandboxes whose boxd predates the field (date hidden). */
  modified_unix: number
}

/** The subset of a sandbox a data-plane file call needs. */
type FileSandbox = Pick<SandboxResponse, "id" | "access_token">

export function filesUrl(
  sandboxId: string,
  path: string,
  params?: Record<string, string>,
): string {
  let url = `https://boxd-${sandboxId}.${sandboxHostFor(sandboxId)}/files?path=${encodeURIComponent(path)}`
  for (const [key, value] of Object.entries(params ?? {})) {
    url += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }
  return url
}

export function isValidAbsolutePath(path: string): boolean {
  if (!path.startsWith("/")) return false
  for (const segment of path.split("/")) {
    if (segment === ".." || segment === ".") return false
  }
  return true
}

/** Join a directory path and a child name into an absolute path. */
export function joinPath(dir: string, name: string): string {
  const base = dir.endsWith("/") ? dir : `${dir}/`
  return `${base}${name}`
}

/**
 * The parent directory of an absolute path. Bottoms out at root:
 * parentPath("/a/b") === "/a", parentPath("/a") === "/", parentPath("/") === "/".
 */
export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "")
  if (trimmed === "") return "/"
  const idx = trimmed.lastIndexOf("/")
  return idx <= 0 ? "/" : trimmed.slice(0, idx)
}

/** Absolute path → ordered breadcrumbs (root excluded). */
export function pathSegments(path: string): { name: string; path: string }[] {
  const crumbs: { name: string; path: string }[] = []
  let acc = ""
  for (const part of path.split("/").filter(Boolean)) {
    acc += `/${part}`
    crumbs.push({ name: part, path: acc })
  }
  return crumbs
}

export function fileNameFromPath(path: string): string {
  const clean = path.split(/[?#]/)[0]
  const parts = clean.split("/").filter(Boolean)
  return parts[parts.length - 1] || "download"
}

/**
 * Pull the filename out of a Content-Disposition header. boxd controls the
 * format (`attachment; filename="<name>"`), so a simple match is enough. The
 * data plane runs untrusted user code, so treat its filename as untrusted:
 * reduce it to a basename and reject `.`/`..` so it can't steer the saved path.
 * Returns null when absent, unparseable, or not a usable basename.
 */
export function filenameFromContentDisposition(
  header: string | null,
): string | null {
  if (!header) return null
  const match = /filename=(?:"([^"]*)"|([^;]+))/i.exec(header)
  const trimmed = (match?.[1] ?? match?.[2])?.trim()
  if (!trimmed) return null
  const base = trimmed.slice(
    Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1,
  )
  if (!base || base === "." || base === "..") return null
  return base
}

/**
 * Pull a human-readable message out of a data-plane error response. Bodies are
 * JSON like {"error":"..."} or {"error":{"code","message"}}; fall back to the
 * raw text, then a generic message. Keeps internal error strings out of toasts.
 */
export async function errorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  const text = await res.text().catch(() => "")
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const err = parsed.error
    if (typeof err === "string") return err
    if (err && typeof err === "object" && "message" in err) {
      const message = (err as { message?: unknown }).message
      if (typeof message === "string") return message
    }
    if (typeof parsed.message === "string") return parsed.message
    return fallback
  } catch {
    // Body wasn't JSON; fall through to the raw text.
  }
  return text || fallback
}

/** 2 GiB — matches boxd's server-side zip cap. */
const DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
/** Hard ceiling on a single download, regardless of progress. */
const DEFAULT_TOTAL_TIMEOUT_MS = 300_000
/** Abort if no chunk arrives within this window (stalled stream). */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000

/**
 * A non-OK HTTP response from a bounded download. Carries the status so callers
 * can special-case it (e.g. 404 → "No file found") without re-parsing strings.
 */
export class DownloadError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "DownloadError"
    this.status = status
  }
}

export interface DownloadWithLimitOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Reject once the streamed body exceeds this many bytes. */
  maxBytes?: number
  /** Hard ceiling on total elapsed time before aborting. */
  totalTimeoutMs?: number
  /** Abort if no chunk arrives within this window. */
  idleTimeoutMs?: number
}

/**
 * Stream a download from the (untrusted) data plane into a Blob under strict
 * bounds. boxd runs user code, so a hostile sandbox can return an endless,
 * stalled, or multi-GB body. This caps total bytes, total time, and per-chunk
 * idle time, and stays cancellable via `opts.signal` so a navigated-away or
 * unmounted caller stops consuming memory and network.
 *
 * Throws a clear `Error` on cap breach ("Download exceeds the maximum size") or
 * timeout ("Download timed out"), a `DownloadError` (with `.status`) on a non-OK
 * response, and the underlying `AbortError` on caller-driven abort.
 */
export async function downloadWithLimit(
  url: string,
  opts: DownloadWithLimitOptions = {},
): Promise<{ blob: Blob; contentDisposition: string | null }> {
  const {
    headers,
    signal,
    maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
    totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  } = opts

  const controller = new AbortController()
  let timedOut = false
  let totalTimer: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const clearTimers = () => {
    if (totalTimer !== undefined) clearTimeout(totalTimer)
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    totalTimer = undefined
    idleTimer = undefined
  }

  const abortForTimeout = () => {
    timedOut = true
    controller.abort()
  }

  // Compose the caller's signal: if it aborts, abort our fetch too.
  const onCallerAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", onCallerAbort, { once: true })
  }

  const resetIdleTimer = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = setTimeout(abortForTimeout, idleTimeoutMs)
  }

  try {
    totalTimer = setTimeout(abortForTimeout, totalTimeoutMs)

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await errorMessage(res, `Download failed (${res.status})`)
      throw new DownloadError(detail, res.status)
    }

    const reader = res.body!.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    resetIdleTimer()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          clearTimers()
          throw new Error("Download exceeds the maximum size")
        }
        chunks.push(value)
      }
      resetIdleTimer()
    }

    clearTimers()
    return {
      blob: new Blob(chunks as BlobPart[]),
      contentDisposition: res.headers.get("content-disposition"),
    }
  } catch (err) {
    if (timedOut) throw new Error("Download timed out", { cause: err })
    throw err
  } finally {
    clearTimers()
    if (signal) signal.removeEventListener("abort", onCallerAbort)
  }
}

/** Directories first, then files; each group sorted case-insensitively. */
export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries.toSorted((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
}

/**
 * List a directory's immediate children (non-recursive), dirs-first then alpha.
 *
 * Unlike the byte-transfer helpers, listing is metadata, so it goes through the
 * control-plane API (`GET /sandboxes/:id/files`) rather than the data plane. The
 * API lists via boxd's FilesystemService.ListDir, which every sandbox supports
 * regardless of boxd version — so existing sandboxes list without a reseed.
 * `apiClient` throws `ApiError` (404 → "Folder not found", 400 → bad path),
 * surfaced directly by the UI.
 */
export async function listDir(
  sandbox: FileSandbox,
  path: string,
): Promise<DirEntry[]> {
  const data = await apiClient<{ entries?: DirEntry[] }>(
    `/sandboxes/${sandbox.id}/files?path=${encodeURIComponent(path)}`,
  )
  return sortEntries(Array.isArray(data.entries) ? data.entries : [])
}

/**
 * Upload a browser File into `dirPath`, saved as `<dirPath>/<file.name>`.
 * Returns the absolute target path on success. Validates the target is absolute
 * and traversal-free before hitting the network.
 */
export async function uploadFileTo(
  sandbox: FileSandbox,
  dirPath: string,
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  const target = joinPath(dirPath, file.name)
  if (!isValidAbsolutePath(target)) {
    throw new Error("Upload path must be absolute and free of '..' segments")
  }
  const res = await fetch(filesUrl(sandbox.id, target), {
    method: "POST",
    headers: { "X-Access-Token": sandbox.access_token },
    body: file,
    signal,
  })
  if (!res.ok) {
    throw new Error(await errorMessage(res, `Upload failed (${res.status})`))
  }
  return target
}
