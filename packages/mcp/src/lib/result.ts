/**
 * Helpers for building MCP tool results: every result carries a human-readable
 * `text` block plus machine-readable `structuredContent`, and large text is
 * truncated head+tail so it stays token-efficient.
 */

import type { CallToolResult } from "./sdk.js"

export interface Truncation {
  text: string
  truncated: boolean
  /** Original size in bytes before any truncation. */
  bytes: number
}

/**
 * Truncate `text` to roughly `maxBytes`, keeping the head and tail with a
 * marker in between. Returns the (possibly unchanged) text plus whether it was
 * truncated and the original byte length.
 */
export function truncateText(text: string, maxBytes: number): Truncation {
  const bytes = Buffer.byteLength(text, "utf8")
  if (bytes <= maxBytes) {
    return { text, truncated: false, bytes }
  }
  // Budget characters from the byte cap (approximation is fine for a marker).
  const headChars = Math.floor(maxBytes * 0.6)
  const tailChars = Math.floor(maxBytes * 0.35)
  // Keep slice boundaries off the seam of a UTF-16 surrogate pair — cutting one
  // in half would emit a lone surrogate (a corrupt character) into the output.
  const headEnd = surrogateSafeBoundary(text, Math.min(headChars, text.length))
  const tailStart = Math.max(
    headEnd,
    surrogateSafeBoundary(text, Math.max(0, text.length - tailChars)),
  )
  const head = text.slice(0, headEnd)
  const tail = text.slice(tailStart)
  const dropped = bytes - Buffer.byteLength(head + tail, "utf8")
  return {
    text: `${head}\n… [${dropped} bytes truncated] …\n${tail}`,
    truncated: true,
    bytes,
  }
}

/**
 * Return an index at or just before `index` that does not fall between the two
 * halves of a UTF-16 surrogate pair. If the code unit just before `index` is a
 * high surrogate (0xD800–0xDBFF), step back one so a slice at the returned index
 * keeps the pair whole on both sides.
 */
function surrogateSafeBoundary(text: string, index: number): number {
  if (index > 0 && index < text.length) {
    const prev = text.charCodeAt(index - 1)
    if (prev >= 0xd800 && prev <= 0xdbff) return index - 1
  }
  return index
}

/** A successful tool result: text content + structured content. */
export function toolOk(
  text: string,
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  }
}

/** An error tool result. `isError` lets the model self-correct. */
export function toolError(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
  }
}
