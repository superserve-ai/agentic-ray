/**
 * Superserve MCP server — stdio entry point.
 *
 * Run via `npx -y @superserve/mcp` with `SUPERSERVE_API_KEY` in the environment.
 * All diagnostics go to stderr; stdout is reserved for the JSON-RPC stream.
 */

import { createSdkClient } from "./client.js"
import { ConfigError, looksLikeProdKey, resolveClientConfig } from "./config.js"
import { SERVER_NAME, SERVER_VERSION } from "./constants.js"
import { StdioServerTransport } from "./lib/sdk.js"
import { createServer } from "./server.js"

function fail(message: string): never {
  process.stderr.write(`[${SERVER_NAME}-mcp] ${message}\n`)
  process.exit(1)
}

async function main(): Promise<void> {
  let config
  try {
    config = resolveClientConfig()
  } catch (e) {
    if (e instanceof ConfigError) fail(e.message)
    throw e
  }

  if (!looksLikeProdKey(config.apiKey)) {
    process.stderr.write(
      `[${SERVER_NAME}-mcp] warning: SUPERSERVE_API_KEY does not start with \`ss_live_\`; ` +
        "continuing (use this only for staging/dev keys).\n",
    )
  }

  const client = createSdkClient(config)
  const server = createServer(client)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  process.stderr.write(
    `[${SERVER_NAME}-mcp] v${SERVER_VERSION} ready on stdio\n`,
  )
}

main().catch((e) => {
  fail(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
})
