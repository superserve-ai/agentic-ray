/**
 * Build the Superserve MCP server and register every tool.
 *
 * Exported separately from the stdio entry point so tests can drive it over an
 * in-memory transport with a fake {@link SandboxClient}.
 */

import type { SandboxClient } from "./client.js"
import {
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  SERVER_VERSION,
} from "./constants.js"
import { McpServer } from "./lib/sdk.js"
import { registerExecTool } from "./tools/exec.js"
import { registerFileTools } from "./tools/files.js"
import { registerLifecycleTools } from "./tools/lifecycle.js"
import { registerSecretTools } from "./tools/secrets.js"

export function createServer(client: SandboxClient): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    // Server-wide guidance returned in the initialize handshake (Codex et al.
    // surface this as cross-tool instructions the individual tool descriptions
    // can't convey).
    { instructions: SERVER_INSTRUCTIONS },
  )

  registerLifecycleTools(server, client)
  registerExecTool(server, client)
  registerFileTools(server, client)
  registerSecretTools(server, client)

  return server
}
