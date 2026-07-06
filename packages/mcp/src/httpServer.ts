/**
 * Standalone Node HTTP server for the hosted Superserve MCP server.
 *
 * The runnable Tier 1 prototype: serves the Streamable HTTP transport over
 * `node:http` for local development and container / standalone deploys. For
 * Next.js or other `fetch` runtimes, import `handleMcpRequest` from `./http.js`
 * instead of running this.
 *
 * - `POST /` (or `/mcp`) — the MCP endpoint (bearer-authenticated)
 * - `GET /health` — liveness probe (no auth)
 *
 * Config: `PORT` (default 8080), `SUPERSERVE_BASE_URL` (optional, staging).
 * Diagnostics go to stderr; the API key is never logged.
 */

import { createServer as createHttpServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"

import { MAX_REQUEST_BYTES, SERVER_NAME, SERVER_VERSION } from "./constants.js"
import {
  buildServerForKey,
  extractBearerToken,
  JSON_RPC,
  resolveBaseUrl,
  UNAUTHORIZED_MESSAGE,
} from "./lib/httpAuth.js"
import {
  parseJsonBody,
  PAYLOAD_TOO_LARGE_MESSAGE,
  readNodeRequestBody,
} from "./lib/httpBody.js"
import { StreamableHTTPServerTransport } from "./lib/sdk.js"

const DEFAULT_PORT = 8080

function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...headers })
  res.end(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
  )
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const apiKey = extractBearerToken(req.headers.authorization)
  if (!apiKey) {
    writeJsonRpcError(res, 401, JSON_RPC.UNAUTHORIZED, UNAUTHORIZED_MESSAGE, {
      "www-authenticate": 'Bearer realm="superserve-mcp"',
    })
    return
  }

  // Bound and parse the body before the transport touches it: a hostile caller
  // must not be able to exhaust memory with a giant JSON-RPC payload.
  const buffered = await readNodeRequestBody(req, MAX_REQUEST_BYTES)
  if (!buffered.ok) {
    writeJsonRpcError(
      res,
      413,
      JSON_RPC.PAYLOAD_TOO_LARGE,
      PAYLOAD_TOO_LARGE_MESSAGE,
    )
    return
  }
  const parsed = parseJsonBody(buffered.bytes)
  if (!parsed) {
    writeJsonRpcError(
      res,
      400,
      JSON_RPC.PARSE_ERROR,
      "Parse error: invalid JSON body.",
    )
    return
  }

  const server = buildServerForKey(apiKey, resolveBaseUrl())
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  })
  // Tear down the per-request server/transport once the response is done.
  res.on("close", () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, parsed.value)
}

function listener(req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? "/").split("?")[0] ?? "/"

  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        status: "ok",
        server: SERVER_NAME,
        version: SERVER_VERSION,
      }),
    )
    return
  }

  if (path !== "/" && path !== "/mcp") {
    writeJsonRpcError(res, 404, -32601, "Not found.")
    return
  }

  if (req.method !== "POST") {
    writeJsonRpcError(
      res,
      405,
      JSON_RPC.SERVER_ERROR,
      "Method not allowed. Use POST for MCP requests.",
      { allow: "POST" },
    )
    return
  }

  handleMcp(req, res).catch((err: unknown) => {
    process.stderr.write(
      `[${SERVER_NAME}-mcp-http] request error: ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
    )
    if (res.headersSent) res.end()
    else writeJsonRpcError(res, 500, JSON_RPC.INTERNAL, "Internal error.")
  })
}

function main(): void {
  const port = Number(process.env.PORT) || DEFAULT_PORT
  const baseUrl = resolveBaseUrl()
  createHttpServer(listener).listen(port, () => {
    process.stderr.write(
      `[${SERVER_NAME}-mcp-http] v${SERVER_VERSION} listening on :${port}` +
        (baseUrl ? ` → ${baseUrl}` : "") +
        "\n",
    )
  })
}

main()
