/**
 * Secret tools: `secret_list`, `sandbox_attach_secret`, `sandbox_detach_secret`.
 *
 * These bind **already-stored** team secrets to sandboxes so credentials never
 * enter the sandbox as plaintext (the agent sees a proxy token; the platform
 * swaps in the real value at egress). Secret *creation* is intentionally not an
 * MCP tool — it takes a raw credential value, which belongs on the SDK/console,
 * not in an agent's tool-call transcript. `secret_list` returns metadata only.
 */

import { z } from "zod"

import type { SandboxClient } from "../client.js"
import { formatSdkError } from "../lib/errors.js"
import { toolError, toolOk } from "../lib/result.js"
import type { McpServer } from "../lib/sdk.js"
import { defineTool } from "../lib/tool.js"

type EmptyArgs = Record<string, never>

interface AttachArgs {
  sandbox_id: string
  env_key: string
  secret_name: string
}

interface DetachArgs {
  sandbox_id: string
  env_key: string
}

export function registerSecretTools(
  server: McpServer,
  client: SandboxClient,
): void {
  defineTool<EmptyArgs>(
    server,
    "secret_list",
    {
      title: "List team secrets",
      description:
        "List the team's stored secrets you can bind to sandboxes — names, auth type, and allowed hosts. " +
        "Returns metadata only; secret values never leave the platform. Bind one with sandbox_attach_secret " +
        "or the secrets argument on sandbox_create. Create new secrets via the Superserve SDK or console.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const secrets = await client.listSecrets()
        const text = secrets.length
          ? secrets
              .map((s) => `${s.name}\t${s.authType}\t${s.hosts.join(",")}`)
              .join("\n")
          : "(no secrets)"
        return toolOk(text, { secrets })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<AttachArgs>(
    server,
    "sandbox_attach_secret",
    {
      title: "Bind a secret to a sandbox",
      description:
        "Bind a stored team secret to a sandbox under an environment variable. The sandbox sees a proxy token; " +
        "the platform swaps in the real credential for outbound requests to the secret's allowed hosts. Takes " +
        "effect for processes started after this call. Auto-resumes a paused sandbox.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        env_key: z
          .string()
          .describe(
            'Environment variable the sandbox reads, e.g. "OPENAI_API_KEY".',
          ),
        secret_name: z
          .string()
          .describe("Name of the stored secret to bind (see secret_list)."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, env_key, secret_name }) => {
      try {
        await client.attachSecret(sandbox_id, env_key, secret_name)
        return toolOk(
          `bound secret ${secret_name} to ${env_key} on ${sandbox_id}`,
          {
            sandbox_id,
            env_key,
            secret_name,
          },
        )
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<DetachArgs>(
    server,
    "sandbox_detach_secret",
    {
      title: "Unbind a secret from a sandbox",
      description:
        "Remove a secret binding from a sandbox by its environment-variable key. The proxy token is revoked, so " +
        "requests using it are refused. Auto-resumes a paused sandbox. Idempotent.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        env_key: z
          .string()
          .describe("Environment-variable key of the binding to remove."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, env_key }) => {
      try {
        await client.detachSecret(sandbox_id, env_key)
        return toolOk(`unbound ${env_key} from ${sandbox_id}`, {
          sandbox_id,
          env_key,
        })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )
}
