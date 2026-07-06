/**
 * Lifecycle + discovery tools:
 * `sandbox_create`, `sandbox_list`, `sandbox_info`,
 * `sandbox_pause`, `sandbox_resume`, `sandbox_kill`.
 */

import type { BuildStep, NetworkConfig } from "@superserve/sdk"
import { z } from "zod"

import type { SandboxClient } from "../client.js"
import {
  DEFAULT_NETWORK_LOG_LIMIT,
  MAX_NETWORK_LOG_LIMIT,
} from "../constants.js"
import { formatSdkError } from "../lib/errors.js"
import { toolError, toolOk } from "../lib/result.js"
import type { McpServer } from "../lib/sdk.js"
import { defineTool } from "../lib/tool.js"

/**
 * A `Record<string, string>` schema. A factory — not a shared constant —
 * because reusing one Zod instance for two fields of the *same* tool makes the
 * SDK's zod→JSON-Schema converter dedupe the second into a `$ref`
 * (`#/properties/...`). Strict clients/models (OpenAI function-calling, Gemini)
 * don't resolve `$ref`, so the field silently becomes uncallable. A fresh
 * instance per field keeps every property inlined.
 */
const stringRecord = () => z.record(z.string(), z.string())

/** A `string[]` schema — a factory for the same anti-`$ref` reason as {@link stringRecord}. */
const stringArray = () => z.array(z.string())

interface CreateArgs {
  name?: string
  from_template?: string
  from_snapshot?: string
  timeout_seconds?: number
  metadata?: Record<string, string>
  env_vars?: Record<string, string>
  secrets?: Record<string, string>
  allow_out?: string[]
  deny_out?: string[]
}

interface UpdateArgs {
  sandbox_id: string
  metadata?: Record<string, string>
  allow_out?: string[]
  deny_out?: string[]
}

interface TemplateCreateArgs {
  name: string
  from: string
  vcpu?: number
  memory_mib?: number
  disk_mib?: number
  run_steps?: string[]
  start_cmd?: string
  ready_cmd?: string
}

interface PreviewUrlArgs {
  sandbox_id: string
  port: number
}

interface NetworkLogArgs {
  sandbox_id: string
  limit?: number
  verdict?: "allowed" | "blocked" | "failed"
}

interface ListArgs {
  metadata?: Record<string, string>
}

interface TemplateListArgs {
  name_prefix?: string
}

interface IdArg {
  sandbox_id: string
}

/**
 * Build the SDK `network` config from flat `allow_out`/`deny_out` tool args.
 * Returns `undefined` when neither is supplied so an update leaves egress rules
 * untouched (rather than clearing them).
 */
function toNetwork(
  allowOut?: string[],
  denyOut?: string[],
): NetworkConfig | undefined {
  if (allowOut === undefined && denyOut === undefined) return undefined
  return { allowOut, denyOut }
}

export function registerLifecycleTools(
  server: McpServer,
  client: SandboxClient,
): void {
  defineTool<CreateArgs>(
    server,
    "sandbox_create",
    {
      title: "Create a sandbox",
      description:
        "Create a new Superserve sandbox (a Firecracker microVM). Returns the sandbox id to use in " +
        "subsequent tool calls. The sandbox is active and ready immediately.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Human-readable name (auto-generated if omitted)."),
        from_template: z
          .string()
          .optional()
          .describe(
            "Template (prebuilt base image) name or ID to base the sandbox on. " +
              "Call sandbox_template_list first to see what your team has — don't guess a name.",
          ),
        from_snapshot: z
          .string()
          .optional()
          .describe("Snapshot ID to restore the sandbox from."),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Idle timeout before the sandbox is auto-paused."),
        metadata: stringRecord()
          .optional()
          .describe("Arbitrary key/value tags for filtering in sandbox_list."),
        env_vars: stringRecord()
          .optional()
          .describe(
            "Plain environment variables for commands in the sandbox. Do NOT put credentials " +
              "here — bind them with `secrets` instead so the real value never enters the sandbox.",
          ),
        secrets: stringRecord()
          .optional()
          .describe(
            "Bind team-stored secrets to env vars: { ENV_VAR: secret_name }. The agent sees a " +
              "proxy token; the platform swaps in the real credential at egress. List bindable " +
              "secrets with secret_list. Create secrets via the Superserve SDK/console.",
          ),
        allow_out: stringArray()
          .optional()
          .describe(
            "Egress allow rules — domain patterns (e.g. 'api.github.com', '*.github.com') or CIDRs to permit. " +
              "This ADDS allowed destinations; on its own it does NOT block anything else. For a strict allowlist " +
              "(deny everything except these), also pass deny_out: ['0.0.0.0/0'].",
          ),
        deny_out: stringArray()
          .optional()
          .describe(
            "Egress deny rules — CIDRs only (use '0.0.0.0/0' to deny all egress). Combine deny_out: ['0.0.0.0/0'] " +
              "with allow_out to lock the sandbox down to just the allowed destinations.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      name,
      from_template,
      from_snapshot,
      timeout_seconds,
      metadata,
      env_vars,
      secrets,
      allow_out,
      deny_out,
    }) => {
      try {
        const s = await client.create({
          name,
          fromTemplate: from_template,
          fromSnapshot: from_snapshot,
          timeoutSeconds: timeout_seconds,
          metadata,
          envVars: env_vars,
          secrets,
          network: toNetwork(allow_out, deny_out),
        })
        return toolOk(
          `created sandbox ${s.id} (${s.name}), status ${s.status}`,
          { ...s },
        )
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<TemplateListArgs>(
    server,
    "sandbox_template_list",
    {
      title: "List templates",
      description:
        "List the templates (prebuilt base images) your team can launch sandboxes from. Call this " +
        "before sandbox_create to choose a from_template instead of guessing a name. Official " +
        "templates are curated by Superserve, available to every team, and named with the reserved " +
        "`superserve/` prefix — e.g. `superserve/python-3.11`, `superserve/node-22`, " +
        "`superserve/openclaw`; names without that prefix are your team's own templates. Returns " +
        "each template's name, status, and resources; only templates whose status is ready can be used.",
      inputSchema: {
        name_prefix: z
          .string()
          .optional()
          .describe(
            "Only return templates whose name starts with this prefix — e.g. 'superserve/' " +
              "for the official curated templates, or 'python'.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ name_prefix }) => {
      try {
        const templates = await client.listTemplates(name_prefix)
        const text = templates.length
          ? templates
              .map(
                (t) =>
                  `${t.name}\t${t.status}\t${t.vcpu} vCPU / ${t.memoryMib} MiB`,
              )
              .join("\n")
          : "(no templates)"
        return toolOk(text, { templates })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<TemplateCreateArgs>(
    server,
    "sandbox_template_create",
    {
      title: "Build a custom template",
      description:
        "Build a reusable template (base image) so you can launch sandboxes with a specific vCPU/memory/disk " +
        "shape or preinstalled software. Sandbox resources are inherited from the template and cannot be set at " +
        "sandbox_create time, so this is how you get, say, a 4 vCPU sandbox. The build runs asynchronously: this " +
        "returns immediately with status 'building' (or 'pending'). Poll sandbox_template_list (filter by name) " +
        "until the template's status is 'ready' before passing it to sandbox_create's from_template. A build " +
        "can take a few minutes.",
      inputSchema: {
        name: z
          .string()
          .describe(
            "Template name (your team's namespace; cannot start with the reserved 'superserve/').",
          ),
        from: z
          .string()
          .describe(
            "Base image to build from, e.g. a Docker image like 'python:3.11' or 'ubuntu:24.04'.",
          ),
        vcpu: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("vCPU count for sandboxes built from this template."),
        memory_mib: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Memory (MiB) for sandboxes built from this template."),
        disk_mib: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Disk (MiB) for sandboxes built from this template."),
        run_steps: stringArray()
          .optional()
          .describe(
            "Shell commands run in order at build time, e.g. ['pip install numpy', 'apt-get install -y git']. " +
              "Use these for env/workdir too (e.g. 'export X=Y && ...').",
          ),
        start_cmd: z
          .string()
          .optional()
          .describe(
            "Command to start when a sandbox boots from this template.",
          ),
        ready_cmd: z
          .string()
          .optional()
          .describe(
            "Command that must exit 0 before the build is considered ready.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      name,
      from,
      vcpu,
      memory_mib,
      disk_mib,
      run_steps,
      start_cmd,
      ready_cmd,
    }) => {
      try {
        const steps: BuildStep[] | undefined = run_steps?.map((run) => ({
          run,
        }))
        const t = await client.createTemplate({
          name,
          from,
          vcpu,
          memoryMib: memory_mib,
          diskMib: disk_mib,
          steps,
          startCmd: start_cmd,
          readyCmd: ready_cmd,
        })
        return toolOk(
          `building template ${t.name} (${t.vcpu} vCPU / ${t.memoryMib} MiB), status ${t.status}. ` +
            `Poll sandbox_template_list until status is 'ready', then use from_template: "${t.name}".`,
          { template: t },
        )
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<ListArgs>(
    server,
    "sandbox_list",
    {
      title: "List sandboxes",
      description:
        "List your sandboxes (active and paused), optionally filtered by metadata. " +
        "Returns ids, names, and statuses.",
      inputSchema: {
        metadata: stringRecord()
          .optional()
          .describe(
            "Filter to sandboxes whose metadata matches these key/values.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ metadata }) => {
      try {
        const sandboxes = await client.list(metadata)
        const text = sandboxes.length
          ? sandboxes.map((s) => `${s.id}  ${s.status}\t${s.name}`).join("\n")
          : "(no sandboxes)"
        return toolOk(text, { sandboxes })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<IdArg>(
    server,
    "sandbox_info",
    {
      title: "Get sandbox details",
      description:
        "Get current details (status, resources, metadata, timeout) for one sandbox by id. " +
        "Read-only — does not resume a paused sandbox.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id }) => {
      try {
        const i = await client.info(sandbox_id)
        const structured: Record<string, unknown> = {
          id: i.id,
          name: i.name,
          status: i.status,
          vcpu_count: i.vcpuCount,
          memory_mib: i.memoryMib,
          created_at: toIsoOrUndefined(i.createdAt),
          metadata: i.metadata,
        }
        if (i.timeoutSeconds !== undefined) {
          structured.timeout_seconds = i.timeoutSeconds
        }
        if (i.network) {
          structured.network = {
            allow_out: i.network.allowOut,
            deny_out: i.network.denyOut,
          }
        }
        if (i.secrets?.length) {
          // Bindings only (env var → secret name + revoked); never the value.
          structured.secrets = i.secrets.map((b) => ({
            env_key: b.envKey,
            secret_name: b.secretName,
            revoked: b.revoked,
          }))
        }
        return toolOk(
          `${i.id} (${i.name}) — ${i.status}, ${i.vcpuCount} vCPU / ${i.memoryMib} MiB`,
          structured,
        )
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<IdArg>(
    server,
    "sandbox_pause",
    {
      title: "Pause a sandbox",
      description:
        "Pause a sandbox to save resources. State is preserved; resume it, or just run a command " +
        "(exec auto-resumes).",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox to pause."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id }) => {
      try {
        await client.pause(sandbox_id)
        return toolOk(`paused ${sandbox_id}`, {
          id: sandbox_id,
          status: "paused",
        })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<IdArg>(
    server,
    "sandbox_resume",
    {
      title: "Resume a sandbox",
      description:
        "Explicitly resume a paused sandbox. Usually unnecessary — sandbox_exec and the file tools " +
        "auto-resume a paused sandbox.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox to resume."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id }) => {
      try {
        const s = await client.resume(sandbox_id)
        return toolOk(`resumed ${s.id}`, { id: s.id, status: "active" })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<IdArg>(
    server,
    "sandbox_kill",
    {
      title: "Delete a sandbox",
      description:
        "Permanently delete a sandbox and all its state. Irreversible. Idempotent — deleting an " +
        "already-deleted sandbox succeeds.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox to delete."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id }) => {
      try {
        await client.kill(sandbox_id)
        return toolOk(`deleted ${sandbox_id}`, {
          id: sandbox_id,
          deleted: true,
        })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<UpdateArgs>(
    server,
    "sandbox_update",
    {
      title: "Update a sandbox",
      description:
        "Change a sandbox's metadata or egress network rules after creation. Use this to lock down or open up " +
        "outbound network access on an existing sandbox (the rules apply to new connections). Only the fields " +
        "you pass are changed; omit allow_out/deny_out to leave network rules untouched.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox to update."),
        metadata: stringRecord()
          .optional()
          .describe("Replacement key/value metadata tags."),
        allow_out: stringArray()
          .optional()
          .describe(
            "Egress allow rules — domain patterns or CIDRs to permit. Adds allowed destinations; does NOT by " +
              "itself block other egress. For a strict allowlist, also pass deny_out: ['0.0.0.0/0'].",
          ),
        deny_out: stringArray()
          .optional()
          .describe(
            "Egress deny rules — CIDRs only ('0.0.0.0/0' denies all egress). Combine with allow_out to lock down egress.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, metadata, allow_out, deny_out }) => {
      try {
        await client.update(sandbox_id, {
          metadata,
          network: toNetwork(allow_out, deny_out),
        })
        return toolOk(`updated ${sandbox_id}`, { id: sandbox_id })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<PreviewUrlArgs>(
    server,
    "sandbox_preview_url",
    {
      title: "Get a port's public URL",
      description:
        "Return the public preview URL for a port in a sandbox. Any process listening on that port is reachable " +
        "at this URL over the public internet with NO authentication — share it carefully, and only expose ports " +
        "you intend to be public. This just builds the URL; it does not verify a process is listening (start one " +
        "with sandbox_exec, e.g. `python3 -m http.server 8000`, and find listeners with `ss -ltnp`).",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        port: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .describe("The port a process is (or will be) listening on."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, port }) => {
      try {
        const url = client.previewUrl(sandbox_id, port)
        return toolOk(url, { sandbox_id, port, url })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<NetworkLogArgs>(
    server,
    "sandbox_network_log",
    {
      title: "Audit a sandbox's egress",
      description:
        "List the outbound network connections a sandbox made (newest first) — host, verdict (allowed/blocked), " +
        "bytes, and credential-injected requests. Use it to audit what a sandbox actually reached and to verify " +
        "allow_out/deny_out rules. Read-only — does not resume a paused sandbox.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            `Max rows to return (default ${DEFAULT_NETWORK_LOG_LIMIT}, capped at ${MAX_NETWORK_LOG_LIMIT}).`,
          ),
        verdict: z
          .enum(["allowed", "blocked", "failed"])
          .optional()
          .describe("Filter to connections with this verdict."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, limit, verdict }) => {
      try {
        const capped = Math.min(
          limit ?? DEFAULT_NETWORK_LOG_LIMIT,
          MAX_NETWORK_LOG_LIMIT,
        )
        const page = await client.networkLog(sandbox_id, {
          limit: capped,
          verdict,
        })
        const text = page.events.length
          ? page.events
              .map((e) =>
                e.kind === "request"
                  ? `${e.ts.toISOString()}\treq ${e.method ?? ""} ${e.host ?? ""}${e.path ?? ""} → ${e.status ?? ""}`
                  : `${e.ts.toISOString()}\t${e.verdict ?? "conn"} ${e.host ?? e.dstIp ?? ""}`,
              )
              .join("\n")
          : "(no network activity)"
        return toolOk(text, {
          events: page.events,
          has_more: page.hasMore,
          next_cursor: page.nextCursor,
        })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )
}

/**
 * ISO-8601 string for a Date, or undefined when it is missing or invalid.
 * Guards `.toISOString()`, which throws a RangeError on an Invalid Date — a case
 * optional chaining would not catch (the value is a Date object, just NaN).
 */
function toIsoOrUndefined(d: Date | undefined): string | undefined {
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined
}
