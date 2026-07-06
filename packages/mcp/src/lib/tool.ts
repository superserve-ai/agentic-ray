/**
 * Thin wrapper over `McpServer.registerTool`.
 *
 * `registerTool`'s generics infer each tool's argument type from its zod input
 * shape; across our tools that hits TS2589 ("type instantiation is excessively
 * deep") and balloons `tsc` memory. This wrapper erases that inference — the
 * SDK still validates inputs against `inputSchema` at runtime and converts it to
 * the advertised JSON Schema — and we type each handler's args explicitly at the
 * call site instead.
 */

import type { ZodRawShape } from "zod"

import type { CallToolResult, McpServer, ToolAnnotations } from "./sdk.js"

export interface ToolConfig {
  title?: string
  description: string
  inputSchema: ZodRawShape
  annotations?: ToolAnnotations
}

export type ToolHandler<A> = (
  args: A,
) => CallToolResult | Promise<CallToolResult>

type ErasedHandler = (
  args: Record<string, unknown>,
) => CallToolResult | Promise<CallToolResult>

interface ServerWithErasedRegister {
  registerTool: (
    name: string,
    config: ToolConfig,
    handler: ErasedHandler,
  ) => void
}

export function defineTool<A>(
  server: McpServer,
  name: string,
  config: ToolConfig,
  handler: ToolHandler<A>,
): void {
  // Call as a method on `server` so `this` is preserved (extracting the method
  // into a local would lose the binding). The cast erases registerTool's heavy
  // generics; runtime behavior is identical.
  const erased = server as unknown as ServerWithErasedRegister
  erased.registerTool(name, config, handler as ErasedHandler)
}
