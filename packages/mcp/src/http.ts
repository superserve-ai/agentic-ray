/**
 * Web-standard (`Request` → `Response`) HTTP handler for the hosted Superserve
 * MCP server — Tier 1 "hosted" deployment.
 *
 * Wire it into any `fetch`-style runtime. In the Next.js console it backs the
 * `mcp.superserve.ai` route:
 *
 * ```ts
 * import { handleMcpRequest } from "@superserve/mcp/http"
 * export const POST = (req: Request) => handleMcpRequest(req)
 * ```
 *
 * Stateless: a fresh MCP server + transport is built per request and torn down
 * after, so there is no session affinity and it scales horizontally. The
 * caller's API key is the bearer token; nothing is cached between requests.
 * Runs on Node 18+, Cloudflare Workers, Deno, and Bun.
 */

import { MAX_REQUEST_BYTES } from "./constants.js"
import {
  buildServerForKey,
  extractBearerToken,
  JSON_RPC,
  jsonRpcErrorBody,
  resolveBaseUrl,
  UNAUTHORIZED_MESSAGE,
} from "./lib/httpAuth.js"
import {
  parseJsonBody,
  PAYLOAD_TOO_LARGE_MESSAGE,
  readWebRequestBody,
} from "./lib/httpBody.js"
import { WebStandardStreamableHTTPServerTransport } from "./lib/sdk.js"

function unauthorized(): Response {
  return new Response(
    jsonRpcErrorBody(JSON_RPC.UNAUTHORIZED, UNAUTHORIZED_MESSAGE),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="superserve-mcp"',
      },
    },
  )
}

function methodNotAllowed(): Response {
  return new Response(
    jsonRpcErrorBody(
      JSON_RPC.SERVER_ERROR,
      "Method not allowed. Use POST for MCP requests.",
    ),
    {
      status: 405,
      headers: { "content-type": "application/json", allow: "POST" },
    },
  )
}

function payloadTooLarge(): Response {
  return new Response(
    jsonRpcErrorBody(JSON_RPC.PAYLOAD_TOO_LARGE, PAYLOAD_TOO_LARGE_MESSAGE),
    { status: 413, headers: { "content-type": "application/json" } },
  )
}

function badJson(): Response {
  return new Response(
    jsonRpcErrorBody(JSON_RPC.PARSE_ERROR, "Parse error: invalid JSON body."),
    { status: 400, headers: { "content-type": "application/json" } },
  )
}

/**
 * Handle one MCP request. Only `POST` carries JSON-RPC; `GET` / `DELETE` (SSE
 * stream / session end) are unused by this stateless server and answered with
 * 405 so clients do not hold an idle stream open.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed()

  const apiKey = extractBearerToken(request.headers.get("authorization"))
  if (!apiKey) return unauthorized()

  // Bound and parse the body before the transport touches it: a hostile caller
  // must not be able to exhaust memory with a giant JSON-RPC payload.
  const buffered = await readWebRequestBody(request, MAX_REQUEST_BYTES)
  if (!buffered.ok) return payloadTooLarge()
  const parsed = parseJsonBody(buffered.bytes)
  if (!parsed) return badJson()

  const server = buildServerForKey(apiKey, resolveBaseUrl())
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session affinity
    enableJsonResponse: true, // buffered JSON response, not a long-lived SSE stream
  })

  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request, {
      parsedBody: parsed.value,
    })
    // Read the (buffered JSON) body before tearing down the per-request server.
    const body = await response.arrayBuffer()
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    })
  } finally {
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
}
