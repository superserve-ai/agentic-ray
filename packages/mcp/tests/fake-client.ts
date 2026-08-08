/** In-memory fake {@link SandboxClient} for tests (no network, no credentials). */

import { NotFoundError, ValidationError } from "@superserve/sdk"
import type {
  CommandResult,
  NetworkConfig,
  NetworkEvent,
  NetworkLogPage,
  PreviewAccess,
  PreviewAccessPolicy,
  SandboxInfo,
  SandboxSecretBinding,
  SandboxStatus,
} from "@superserve/sdk"
import type { DesktopAction, Screenshot } from "@superserve/sdk"

import type {
  ExecInput,
  SandboxClient,
  SandboxSummary,
  SecretSummary,
  TemplateSummary,
} from "../src/client.js"
import type { DirEntry } from "../src/lib/listing.js"
import { buildPreviewUrl } from "../src/lib/previewUrl.js"

interface FakeSandbox {
  id: string
  name: string
  status: SandboxStatus
  metadata: Record<string, string>
  files: Map<string, Uint8Array>
  network?: NetworkConfig
  secrets: SandboxSecretBinding[]
  autoDeleteSeconds?: number
  timeoutSeconds?: number
  previewAccess: PreviewAccess
  publishedPorts: Map<number, PreviewAccessPolicy>
}

export interface FakeClient {
  client: SandboxClient
  sandboxes: Map<string, FakeSandbox>
  /** Seed-able template catalog returned by `listTemplates`. */
  templates: TemplateSummary[]
  /** Seed-able secret catalog returned by `listSecrets`. */
  secrets: SecretSummary[]
  /** Seed-able egress rows returned by `networkLog`. */
  networkEvents: NetworkEvent[]
  /** The options the most recent `exec` call received (for asserting clamps). */
  lastExec: { command: string; opts: ExecInput } | undefined
  /** Every desktopActions batch received, in order (for asserting lowering). */
  desktopBatches: DesktopAction[][]
  /** Screenshot returned by desktopScreenshot (seed-able). */
  screenshot: Screenshot
  /** Every desktopResize call received. */
  resizes: Array<{ width: number; height: number }>
}

export function createFakeClient(): FakeClient {
  const sandboxes = new Map<string, FakeSandbox>()
  const templates: TemplateSummary[] = []
  const secrets: SecretSummary[] = []
  const networkEvents: NetworkEvent[] = []
  const fake: Pick<FakeClient, "lastExec"> = { lastExec: undefined }
  const desktopBatches: DesktopAction[][] = []
  const resizes: Array<{ width: number; height: number }> = []
  // Not a decodable PNG — the MCP layer treats image bytes as opaque.
  const screenshot: Screenshot = {
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    width: 1280,
    height: 800,
  }
  let counter = 0

  const must = (id: string): FakeSandbox => {
    const sb = sandboxes.get(id)
    if (!sb) throw new NotFoundError(`Sandbox ${id} not found`)
    return sb
  }

  const summarize = (sb: FakeSandbox): SandboxSummary => ({
    id: sb.id,
    name: sb.name,
    status: sb.status,
    metadata: sb.metadata,
    previewAccess: sb.previewAccess,
  })

  const client: SandboxClient = {
    async create(input) {
      const id = `sbx-${++counter}`
      const sb: FakeSandbox = {
        id,
        name: input.name ?? id,
        status: "active",
        metadata: input.metadata ?? {},
        files: new Map(),
        network: input.network,
        autoDeleteSeconds: input.autoDeleteSeconds,
        timeoutSeconds: input.timeoutSeconds ?? 3600,
        previewAccess: input.previewAccess ?? "public",
        publishedPorts: new Map(),
        secrets: Object.entries(input.secrets ?? {}).map(
          ([envKey, secretName]) => ({ envKey, secretName, revoked: false }),
        ),
      }
      sandboxes.set(id, sb)
      return summarize(sb)
    },

    async update(id, input) {
      const sb = must(id)
      if (input.metadata !== undefined) sb.metadata = input.metadata
      if (input.network !== undefined) sb.network = input.network
      if (input.autoDeleteSeconds !== undefined)
        sb.autoDeleteSeconds = input.autoDeleteSeconds ?? undefined
      if (input.timeoutSeconds !== undefined)
        sb.timeoutSeconds = input.timeoutSeconds ?? undefined
      if (input.previewAccess !== undefined)
        sb.previewAccess = input.previewAccess
    },

    async list(metadata) {
      let xs = [...sandboxes.values()]
      if (metadata) {
        xs = xs.filter((sb) =>
          Object.entries(metadata).every(([k, v]) => sb.metadata[k] === v),
        )
      }
      return xs.map(summarize)
    },

    async listTemplates(namePrefix) {
      if (!namePrefix) return [...templates]
      return templates.filter((t) => t.name.startsWith(namePrefix))
    },

    async createTemplate(input) {
      const summary: TemplateSummary = {
        id: `tpl-${++counter}`,
        name: input.name,
        status: "building",
        vcpu: input.vcpu ?? 2,
        memoryMib: input.memoryMib ?? 2048,
        diskMib: input.diskMib ?? 8192,
      }
      templates.push(summary)
      return summary
    },

    async info(id) {
      const sb = must(id)
      const info: SandboxInfo = {
        id: sb.id,
        name: sb.name,
        status: sb.status,
        vcpuCount: 2,
        memoryMib: 2048,
        createdAt: new Date(0),
        timeoutSeconds: sb.timeoutSeconds,
        autoDeleteSeconds: sb.autoDeleteSeconds,
        network: sb.network,
        metadata: sb.metadata,
        previewAccess: sb.previewAccess,
        secrets: sb.secrets.length ? sb.secrets : undefined,
      }
      return info
    },

    async previewUrl(id, port, _expiresInSeconds) {
      const sb = must(id)
      const url = buildPreviewUrl(id, port)
      const existingAccess = sb.publishedPorts.get(port)
      const access =
        existingAccess ??
        (sb.previewAccess === "private" ? "private" : "public")
      sb.publishedPorts.set(port, access)
      if (access === "public") {
        return {
          url,
          access,
          previewAccess: sb.previewAccess,
          authenticated: false,
        }
      }
      return {
        url: `${url}/?superserve_preview_token=fake-token-${port}`,
        access,
        previewAccess: sb.previewAccess,
        authenticated: true,
      }
    },

    async networkLog(id, opts) {
      must(id)
      const limit = opts.limit ?? 50
      const page: NetworkLogPage = {
        events: networkEvents.slice(0, limit),
        hasMore: networkEvents.length > limit,
      }
      return page
    },

    async listSecrets() {
      return [...secrets]
    },

    async attachSecret(id, envKey, secretName) {
      const sb = must(id)
      sb.secrets = [
        ...sb.secrets.filter((b) => b.envKey !== envKey),
        { envKey, secretName, revoked: false },
      ]
    },

    async detachSecret(id, envKey) {
      const sb = must(id)
      sb.secrets = sb.secrets.filter((b) => b.envKey !== envKey)
    },

    async exec(id, command, opts) {
      const sb = must(id)
      sb.status = "active"
      fake.lastExec = { command, opts }
      const result: CommandResult = command.startsWith("echo ")
        ? {
            stdout: `${command.slice(5)}\n`,
            stderr: "",
            exitCode: 0,
            truncated: false,
          }
        : {
            stdout: `ran: ${command}\n`,
            stderr: "",
            exitCode: 0,
            truncated: false,
          }
      return result
    },

    async readFile(id, path, maxBytes) {
      const sb = must(id)
      const data = sb.files.get(path)
      if (!data) throw new NotFoundError(`File ${path} not found`)
      // Mirror the SDK: a capped read throws rather than returning a partial body.
      if (maxBytes !== undefined && data.byteLength > maxBytes) {
        throw new ValidationError(
          `Response body exceeds the maximum size of ${maxBytes} bytes`,
        )
      }
      return data
    },

    async downloadDir(id, path, maxBytes) {
      const sb = must(id)
      const prefix = path.endsWith("/") ? path : `${path}/`
      // Synthetic "zip": concatenate the bytes of files under the dir. The
      // bytes need not be a real archive — the tool only base64-encodes them.
      const parts = [...sb.files.entries()]
        .filter(([p]) => p === path || p.startsWith(prefix))
        .map(([, data]) => data)
      const total = parts.reduce((n, p) => n + p.byteLength, 0)
      // Mirror the SDK: an over-cap download throws mid-stream, never buffers.
      if (maxBytes !== undefined && total > maxBytes) {
        throw new ValidationError(
          `Response body exceeds the maximum size of ${maxBytes} bytes`,
        )
      }
      const out = new Uint8Array(total)
      let offset = 0
      for (const p of parts) {
        out.set(p, offset)
        offset += p.byteLength
      }
      return out
    },

    async writeFile(id, path, content) {
      const sb = must(id)
      sb.files.set(
        path,
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content,
      )
    },

    async listDir(id, path) {
      const sb = must(id)
      const prefix = path.endsWith("/") ? path : `${path}/`
      const entries: DirEntry[] = []
      for (const [p, data] of sb.files) {
        if (!p.startsWith(prefix)) continue
        const rest = p.slice(prefix.length)
        if (rest.includes("/")) continue
        entries.push({
          name: rest,
          type: "file",
          size: data.byteLength,
          modified: new Date(0).toISOString(),
        })
      }
      return entries
    },

    async pause(id) {
      must(id).status = "paused"
    },

    async resume(id) {
      const sb = must(id)
      sb.status = "active"
      return summarize(sb)
    },

    async kill(id) {
      // Idempotent: deleting a missing sandbox is a no-op.
      sandboxes.delete(id)
    },

    async desktopScreenshot(id) {
      must(id)
      return screenshot
    },

    async desktopActions(id, actions) {
      must(id)
      desktopBatches.push(actions)
    },

    async desktopResize(id, width, height) {
      must(id)
      resizes.push({ width, height })
    },

    async desktopStreamUrl(id) {
      return `https://6080-${must(id).id}.sandbox.example.com/vnc.html?autoconnect=1`
    },
  }

  return {
    client,
    sandboxes,
    templates,
    secrets,
    networkEvents,
    get lastExec() {
      return fake.lastExec
    },
    desktopBatches,
    screenshot,
    resizes,
  }
}
