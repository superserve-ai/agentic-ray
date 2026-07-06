/** Wire an MCP client to the Superserve server over an in-memory transport. */

import type { SandboxClient } from "../src/client.js"
import { Client, InMemoryTransport } from "../src/lib/sdk.js"
import { createServer } from "../src/server.js"

export interface ConnectedClient {
  client: Client
  close: () => Promise<void>
}

export async function connect(
  sandboxClient: SandboxClient,
): Promise<ConnectedClient> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const server = createServer(sandboxClient)
  const client = new Client({ name: "superserve-mcp-test", version: "0.0.0" })
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

/** Call a tool and return its parsed result fields. */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{
  structured: Record<string, unknown>
  text: string
  isError: boolean
}> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content?: Array<{ type: string; text?: string }>
    structuredContent?: Record<string, unknown>
    isError?: boolean
  }
  const text = (res.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n")
  return {
    structured: res.structuredContent ?? {},
    text,
    isError: res.isError === true,
  }
}
