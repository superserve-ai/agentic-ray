/** `sandbox_exec` — run a shell command in a sandbox. */

import { z } from "zod"

import type { SandboxClient } from "../client.js"
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  MAX_EXEC_TIMEOUT_MS,
  MAX_STDERR_BYTES,
  MAX_STDOUT_BYTES,
} from "../constants.js"
import { formatSdkError } from "../lib/errors.js"
import { toolError, toolOk, truncateText } from "../lib/result.js"
import type { McpServer } from "../lib/sdk.js"
import { defineTool } from "../lib/tool.js"

interface ExecArgs {
  sandbox_id: string
  command: string
  cwd?: string
  env?: Record<string, string>
  timeout_ms?: number
}

export function registerExecTool(
  server: McpServer,
  client: SandboxClient,
): void {
  defineTool<ExecArgs>(
    server,
    "sandbox_exec",
    {
      title: "Run a command in a sandbox",
      description:
        "Run a shell command in a Superserve sandbox and return stdout, stderr, and exit code. " +
        "Paused sandboxes are resumed automatically — you do NOT need to resume first.",
      inputSchema: {
        sandbox_id: z
          .string()
          .describe(
            "ID of the sandbox to run in (from sandbox_create or sandbox_list).",
          ),
        command: z
          .string()
          .describe('Shell command to execute, e.g. "python script.py".'),
        cwd: z
          .string()
          .optional()
          .describe("Working directory for the command (absolute path)."),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe("Extra environment variables for this command."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            `Command timeout in milliseconds (default ${DEFAULT_EXEC_TIMEOUT_MS}, clamped to a max of ${MAX_EXEC_TIMEOUT_MS}).`,
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, command, cwd, env, timeout_ms }) => {
      try {
        // Clamp so a caller cannot hold a hosted invocation open indefinitely.
        const timeoutMs = Math.min(
          timeout_ms ?? DEFAULT_EXEC_TIMEOUT_MS,
          MAX_EXEC_TIMEOUT_MS,
        )
        const res = await client.exec(sandbox_id, command, {
          cwd,
          env,
          timeoutMs,
        })
        const out = truncateText(res.stdout, MAX_STDOUT_BYTES)
        const err = truncateText(res.stderr, MAX_STDERR_BYTES)
        const structured = {
          stdout: out.text,
          stderr: err.text,
          exit_code: res.exitCode,
          truncated: out.truncated || err.truncated,
        }
        return toolOk(renderExec(out.text, err.text, res.exitCode), structured)
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )
}

function renderExec(stdout: string, stderr: string, exitCode: number): string {
  const parts = [`exit ${exitCode}`]
  if (stdout) parts.push(`--- stdout ---\n${stdout}`)
  if (stderr) parts.push(`--- stderr ---\n${stderr}`)
  return parts.join("\n")
}
