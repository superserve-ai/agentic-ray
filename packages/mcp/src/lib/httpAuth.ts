/**
 * Shared helpers for the hosted (HTTP) Superserve MCP server.
 *
 * Both HTTP entry points — the Web-standard handler ({@link file://./../http.ts})
 * and the Node server ({@link file://./../httpServer.ts}) — authenticate the
 * same way: the caller's Superserve API key arrives as `Authorization: Bearer
 * <key>`, the exact control-plane credential the SDK already uses, so the
 * platform's per-team scoping applies unchanged. Each request builds a fresh,
 * stateless MCP server bound to that key.
 *
 * Kept transport-agnostic (no `node:http` or Web `Request` imports) so importing
 * these helpers never pulls a specific transport into either bundle.
 */

import { createSdkClient } from "../client.js"
import { createServer } from "../server.js"
import type { McpServer } from "./sdk.js"

const BEARER_SCHEME = /^Bearer[ \t]+(\S.*)$/i

/**
 * Pull the token out of an `Authorization: Bearer <token>` header. Returns
 * `null` when the header is absent, uses another scheme, or carries no token.
 */
export function extractBearerToken(
  authorization: string | null | undefined,
): string | null {
  if (!authorization) return null
  const match = BEARER_SCHEME.exec(authorization.trim())
  const token = match?.[1]?.trim()
  return token ? token : null
}

/**
 * Server-level base-URL override (staging / self-hosted), read once from the
 * environment. The per-request credential is the bearer token; the base URL is
 * deployment config, not per-caller.
 */
export function resolveBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.SUPERSERVE_BASE_URL?.trim() || undefined
}

/** Build a fresh MCP server bound to one caller's key (stateless: one per request). */
export function buildServerForKey(apiKey: string, baseUrl?: string): McpServer {
  return createServer(createSdkClient({ apiKey, baseUrl }))
}

/** Shown when a request arrives without a usable bearer token. */
export const UNAUTHORIZED_MESSAGE =
  "Missing or invalid `Authorization: Bearer <SUPERSERVE_API_KEY>` header. " +
  "Create a key at https://console.superserve.ai."

/** JSON-RPC error codes for pre-dispatch HTTP failures (response `id` is null). */
export const JSON_RPC = {
  /** Generic server error (e.g. wrong HTTP method). */
  SERVER_ERROR: -32000,
  /** Unauthenticated — missing or malformed bearer token. */
  UNAUTHORIZED: -32001,
  /** Request body exceeded the size cap. */
  PAYLOAD_TOO_LARGE: -32002,
  /** Malformed JSON body (standard JSON-RPC parse error code). */
  PARSE_ERROR: -32700,
  /** Internal error. */
  INTERNAL: -32603,
} as const

/** Serialize a transport-level JSON-RPC error envelope (`id: null`). */
export function jsonRpcErrorBody(code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null })
}
