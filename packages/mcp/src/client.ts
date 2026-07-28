/**
 * The platform surface the MCP tools depend on, plus the real implementation
 * backed by `@superserve/sdk`.
 *
 * Tools talk to {@link SandboxClient} (not the SDK directly) so they can be
 * tested against an in-memory fake. The real client reuses the SDK, which keeps
 * the per-sandbox data-plane access token internal and rotates it on resume —
 * the MCP server only ever holds the control-plane API key.
 *
 * Targeting is per-call `sandbox_id` → `Sandbox.connect(id)`, which activates
 * (auto-resuming a paused sandbox) and rotates the token. No cross-call session
 * cache: each call reconnects so the token is always fresh (the SDK's file ops
 * do not auto-retry on a stale token).
 */

import {
  AuthenticationError,
  NotFoundError,
  resolveConfig,
  Sandbox,
  SandboxError,
  Secret,
  Template,
} from "@superserve/sdk"
import type {
  BuildStep,
  CommandResult,
  NetworkConfig,
  NetworkEvent,
  NetworkLogPage,
  PreviewAccess,
  PreviewAccessPolicy,
  SandboxInfo,
  SecretInfo,
  TemplateInfo,
} from "@superserve/sdk"

import type { ClientConfig } from "./config.js"
import {
  buildFallbackCommand,
  buildFindCommand,
  buildLsCommand,
  type DirEntry,
  parseFindOutput,
  parseLsOutput,
  validateAbsolutePath,
} from "./lib/listing.js"
import { buildPreviewUrl } from "./lib/previewUrl.js"

/** Hang guard for the direct control-plane network-log GET. */
const NETWORK_LOG_TIMEOUT_MS = 30_000
const PREVIEW_REQUEST_TIMEOUT_MS = 30_000

/**
 * Raw `GET /sandboxes/{id}/network` shape. The SDK's snake→camel converters
 * (`toNetworkLogPage`) are internal and not exported from the package, so the
 * non-resuming read below maps the fields it needs here. Mirror the SDK's
 * `toNetworkEvent` if either side changes.
 */
interface RawNetworkEvent {
  kind?: string
  id?: number
  ts?: string
  host?: string
  dst_ip?: string
  dst_port?: number
  verdict?: string
  match_rule?: string
  bytes_sent?: number
  bytes_recv?: number
  method?: string
  path?: string
  status?: number
  upstream_status?: number
  latency_ms?: number
  secret_id?: string
  error_code?: string
}

interface RawNetworkPage {
  data?: RawNetworkEvent[]
  next_cursor?: string | null
  has_more?: boolean
}

function toNetworkEvent(raw: RawNetworkEvent): NetworkEvent {
  return {
    kind: (raw.kind ?? "connection") as NetworkEvent["kind"],
    id: raw.id ?? 0,
    // Always a valid Date — callers format with `.toISOString()`.
    ts: raw.ts ? new Date(raw.ts) : new Date(0),
    host: raw.host,
    dstIp: raw.dst_ip,
    dstPort: raw.dst_port,
    verdict: raw.verdict as NetworkEvent["verdict"],
    matchRule: raw.match_rule,
    bytesSent: raw.bytes_sent,
    bytesRecv: raw.bytes_recv,
    method: raw.method,
    path: raw.path,
    status: raw.status,
    upstreamStatus: raw.upstream_status,
    latencyMs: raw.latency_ms,
    secretId: raw.secret_id,
    errorCode: raw.error_code,
  }
}

export interface SandboxSummary {
  id: string
  name: string
  status: string
  metadata: Record<string, string>
  previewAccess: PreviewAccess
}

export interface TemplateSummary {
  id: string
  name: string
  status: string
  vcpu: number
  memoryMib: number
  diskMib: number
}

export interface CreateInput {
  name?: string
  fromTemplate?: string
  fromSnapshot?: string
  timeoutSeconds?: number
  /** Delete the sandbox once continuously paused for this many seconds. */
  autoDeleteSeconds?: number
  metadata?: Record<string, string>
  envVars?: Record<string, string>
  /** Bind team-stored secrets to env vars: `{ ENV_VAR: secretName }`. */
  secrets?: Record<string, string>
  /** Egress allow/deny rules (host patterns). */
  network?: NetworkConfig
  /** Default access for newly published ports. New MCP sandboxes use public. */
  previewAccess?: PreviewAccessPolicy
}

export interface UpdateInput {
  metadata?: Record<string, string>
  network?: NetworkConfig
  /** A number (re)arms the auto-delete window; null disarms it. */
  autoDeleteSeconds?: number | null
  /** A number sets the auto-pause timeout; null disables it. */
  timeoutSeconds?: number | null
  previewAccess?: PreviewAccessPolicy
}

export interface ExecInput {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

export interface TemplateCreateInput {
  name: string
  from: string
  vcpu?: number
  memoryMib?: number
  diskMib?: number
  steps?: BuildStep[]
  startCmd?: string
  readyCmd?: string
}

export interface NetworkLogInput {
  limit?: number
  before?: string
  since?: string
  verdict?: "allowed" | "blocked" | "failed"
}

/**
 * A team secret as exposed to the model: identifying metadata only. The secret
 * **value is never included** — it never leaves the platform in cleartext.
 */
export interface SecretSummary {
  name: string
  authType: string
  hosts: string[]
  providerShortcut?: string
  lastUsedAt?: string
}

export interface PreviewLink {
  url: string
  /** The published port's current routing mode. */
  access: PreviewAccessPolicy
  /** Sandbox default for newly published ports. */
  previewAccess: PreviewAccess
  authenticated: boolean
}

export interface SandboxClient {
  create(input: CreateInput): Promise<SandboxSummary>
  update(id: string, input: UpdateInput): Promise<void>
  list(metadata?: Record<string, string>): Promise<SandboxSummary[]>
  listTemplates(namePrefix?: string): Promise<TemplateSummary[]>
  createTemplate(input: TemplateCreateInput): Promise<TemplateSummary>
  info(id: string): Promise<SandboxInfo>
  /** Publish a port and return a browser-ready URL for its current policy. */
  previewUrl(
    id: string,
    port: number,
    expiresInSeconds: number,
  ): Promise<PreviewLink>
  /**
   * Recent egress events for a sandbox (newest first). Read-only control-plane
   * audit — must NOT resume a paused sandbox.
   */
  networkLog(id: string, opts: NetworkLogInput): Promise<NetworkLogPage>
  /** Team secrets (metadata only — never values). */
  listSecrets(): Promise<SecretSummary[]>
  attachSecret(id: string, envKey: string, secretName: string): Promise<void>
  detachSecret(id: string, envKey: string): Promise<void>
  exec(id: string, command: string, opts: ExecInput): Promise<CommandResult>
  /**
   * Read a file as raw bytes. `maxBytes`, when set, is passed to the SDK so the
   * download is capped at the source instead of after fully buffering it — the
   * SDK throws `ValidationError` rather than returning a partial body.
   */
  readFile(id: string, path: string, maxBytes?: number): Promise<Uint8Array>
  /**
   * Download a directory as a ZIP archive (raw bytes). `maxBytes` is pushed to
   * the SDK so an over-cap directory is rejected mid-stream, not buffered.
   */
  downloadDir(id: string, path: string, maxBytes?: number): Promise<Uint8Array>
  writeFile(
    id: string,
    path: string,
    content: string | Uint8Array,
  ): Promise<void>
  listDir(id: string, path: string): Promise<DirEntry[]>
  pause(id: string): Promise<void>
  resume(id: string): Promise<SandboxSummary>
  kill(id: string): Promise<void>
}

function defaultName(): string {
  return `sandbox-${Date.now().toString(36)}`
}

function toSummary(s: SandboxInfo): SandboxSummary {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    metadata: s.metadata,
    previewAccess: s.previewAccess,
  }
}

function toTemplateSummary(t: TemplateInfo): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    vcpu: t.vcpu,
    memoryMib: t.memoryMib,
    diskMib: t.diskMib,
  }
}

/** Metadata-only projection of a secret — deliberately omits the value. */
function toSecretSummary(s: SecretInfo): SecretSummary {
  return {
    name: s.name,
    authType: s.authType,
    hosts: s.hosts,
    providerShortcut: s.providerShortcut,
    lastUsedAt: s.lastUsedAt?.toISOString(),
  }
}

/** Real client backed by `@superserve/sdk`. */
export function createSdkClient(config: ClientConfig): SandboxClient {
  const conn = { apiKey: config.apiKey, baseUrl: config.baseUrl }
  // Region-resolved endpoints (key prefix → cell), the single source the SDK
  // uses internally — so our direct preview/network calls hit the same cell
  // as the SDK-backed sandbox ops instead of defaulting to the primary.
  // resolveConfig is exported as of @superserve/sdk 0.8.0 — the current
  // MIN_SDK_VERSION floor in mcp-publish.yml (max across features).
  const resolved = resolveConfig({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  })

  return {
    async create(input) {
      const sb = await Sandbox.create({
        name: input.name ?? defaultName(),
        fromTemplate: input.fromTemplate,
        fromSnapshot: input.fromSnapshot,
        timeoutSeconds: input.timeoutSeconds,
        autoDeleteSeconds: input.autoDeleteSeconds,
        metadata: input.metadata,
        envVars: input.envVars,
        secrets: input.secrets,
        network: input.network,
        previewAccess: input.previewAccess ?? "public",
        ...conn,
      })
      return {
        id: sb.id,
        name: sb.name,
        status: sb.status,
        metadata: sb.metadata,
        previewAccess: sb.previewAccess,
      }
    },

    async update(id, input) {
      // updateById (not connect().update()) so patching a paused sandbox —
      // e.g. arming auto-delete — does not resume it. Requires @superserve/sdk
      // >= 0.8.0; MIN_SDK_VERSION in mcp-publish.yml tracks this floor.
      await Sandbox.updateById(
        id,
        {
          metadata: input.metadata,
          network: input.network,
          autoDeleteSeconds: input.autoDeleteSeconds,
          timeoutSeconds: input.timeoutSeconds,
          previewAccess: input.previewAccess,
        },
        conn,
      )
    },

    async list(metadata) {
      const xs = await Sandbox.list({ metadata, ...conn })
      return xs.map(toSummary)
    },

    // Control-plane, team-scoped (API key) — templates are not sandbox output.
    async listTemplates(namePrefix) {
      const xs = await Template.list({ namePrefix, ...conn })
      return xs.map(toTemplateSummary)
    },

    // Kicks off a build and returns immediately; the caller polls
    // listTemplates() for `ready`. We don't block the tool call on a
    // multi-minute build (it would tie up hosted concurrency).
    async createTemplate(input) {
      const t = await Template.create({
        name: input.name,
        from: input.from,
        vcpu: input.vcpu,
        memoryMib: input.memoryMib,
        diskMib: input.diskMib,
        steps: input.steps,
        startCmd: input.startCmd,
        readyCmd: input.readyCmd,
        ...conn,
      })
      return toTemplateSummary({
        id: t.id,
        name: t.name,
        teamId: t.teamId,
        status: t.status,
        vcpu: t.vcpu,
        memoryMib: t.memoryMib,
        diskMib: t.diskMib,
        createdAt: t.createdAt,
      })
    },

    // Read-only: resolved via list() so it never resumes a paused sandbox
    // (the SDK has no static single-sandbox get, and connect() would activate).
    async info(id) {
      const xs = await Sandbox.list({ ...conn })
      const found = xs.find((s) => s.id === id)
      if (!found) throw new NotFoundError(`Sandbox ${id} not found`)
      return found
    },

    // Preview publication is control-plane-only, so this does not activate a
    // paused sandbox. The returned port mode—not the sandbox default—decides
    // whether the link needs an expiring browser bootstrap token.
    async previewUrl(id, port, expiresInSeconds) {
      const previewUrl = buildPreviewUrl(id, port, resolved.sandboxHost)
      const base = resolved.baseUrl
      const encodedId = encodeURIComponent(id)
      const requestJson = async <T>(
        path: string,
        init: RequestInit = {},
      ): Promise<T> => {
        const res = await fetch(new URL(path, base), {
          ...init,
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": config.apiKey,
            ...init.headers,
          },
          signal: AbortSignal.timeout(PREVIEW_REQUEST_TIMEOUT_MS),
        })
        if (!res.ok) {
          if (res.status === 404)
            throw new NotFoundError(`Sandbox ${id} or preview port not found`)
          if (res.status === 401 || res.status === 403)
            throw new AuthenticationError("Authentication failed")
          throw new SandboxError(
            `Preview publication request failed (HTTP ${res.status})`,
          )
        }
        return (await res.json()) as T
      }

      const published = await requestJson<{
        port: number
        token_version: number
        access: PreviewAccessPolicy
      }>(`/sandboxes/${encodedId}/preview-ports`, {
        method: "POST",
        body: JSON.stringify({ port }),
      })
      if (published.access !== "public" && published.access !== "private") {
        throw new SandboxError("Invalid publish-preview-port response")
      }
      const policy = await requestJson<{ preview_access?: PreviewAccess }>(
        `/sandboxes/${encodedId}/preview-ports`,
      )
      const previewAccess = policy.preview_access ?? "legacy_public"
      if (published.access === "public") {
        return {
          url: previewUrl,
          access: published.access,
          previewAccess,
          authenticated: false,
        }
      }

      const credential = await requestJson<{
        token?: string
        query_param?: string
        access: PreviewAccessPolicy
        preview_access?: PreviewAccess
      }>(`/sandboxes/${encodedId}/preview-ports/${port}/token`, {
        method: "POST",
        body: JSON.stringify({ expires_in_seconds: expiresInSeconds }),
      })
      if (
        !credential.token ||
        !credential.query_param ||
        credential.access !== "private"
      ) {
        throw new SandboxError("Invalid preview-token response")
      }
      const signed = new URL(previewUrl)
      signed.searchParams.set(credential.query_param, credential.token)
      return {
        url: signed.toString(),
        access: credential.access,
        previewAccess: credential.preview_access ?? previewAccess,
        authenticated: true,
      }
    },

    // Direct control-plane GET so reading the audit log never activates
    // (resumes) a paused sandbox. The SDK's getNetworkLog is instance-only and
    // would require Sandbox.connect (which resumes); the published SDK has no
    // non-resuming static equivalent. Trusted control-plane endpoint, API-key
    // auth, bounded by `limit` and a request timeout.
    async networkLog(id, opts) {
      const base = resolved.baseUrl
      const url = new URL(`${base}/sandboxes/${encodeURIComponent(id)}/network`)
      if (opts.limit !== undefined)
        url.searchParams.set("limit", String(opts.limit))
      if (opts.verdict !== undefined)
        url.searchParams.set("verdict", opts.verdict)

      const res = await fetch(url, {
        method: "GET",
        headers: { "X-API-Key": config.apiKey },
        signal: AbortSignal.timeout(NETWORK_LOG_TIMEOUT_MS),
      })
      if (!res.ok) {
        if (res.status === 404)
          throw new NotFoundError(`Sandbox ${id} not found`)
        if (res.status === 401 || res.status === 403) {
          throw new AuthenticationError("Authentication failed")
        }
        throw new SandboxError(
          `Network log request failed (HTTP ${res.status})`,
        )
      }
      const raw = (await res.json()) as RawNetworkPage
      return {
        events: (raw.data ?? []).map(toNetworkEvent),
        nextCursor: raw.next_cursor ?? undefined,
        hasMore: raw.has_more ?? false,
      }
    },

    // Team-scoped; metadata only — values never leave the platform.
    async listSecrets() {
      const xs = await Secret.list({ ...conn })
      return xs.map(toSecretSummary)
    },

    async attachSecret(id, envKey, secretName) {
      const sb = await Sandbox.connect(id, conn)
      await sb.attachSecret(envKey, secretName)
    },

    async detachSecret(id, envKey) {
      const sb = await Sandbox.connect(id, conn)
      await sb.detachSecret(envKey)
    },

    async exec(id, command, opts) {
      const sb = await Sandbox.connect(id, conn)
      return sb.commands.run(command, opts)
    },

    async readFile(id, path, maxBytes) {
      const sb = await Sandbox.connect(id, conn)
      return sb.files.read(path, maxBytes !== undefined ? { maxBytes } : {})
    },

    // Zips + streams the dir from the data plane (VM must be up, so connect's
    // resume is intrinsic, like readFile). downloadDir landed in @superserve/sdk
    // 0.7.7; the MCP floor (MIN_SDK_VERSION) is the max across features.
    async downloadDir(id, path, maxBytes) {
      const sb = await Sandbox.connect(id, conn)
      return sb.files.downloadDir(
        path,
        maxBytes !== undefined ? { maxBytes } : {},
      )
    },

    async writeFile(id, path, content) {
      const sb = await Sandbox.connect(id, conn)
      await sb.files.write(path, content)
    },

    async listDir(id, path) {
      validateAbsolutePath(path)
      const sb = await Sandbox.connect(id, conn)
      const found = await sb.commands.run(buildFindCommand(path))
      if (found.exitCode === 0) return parseFindOutput(found.stdout)
      // `find -printf` unavailable (e.g. BusyBox) — fall back to `ls`.
      const ls = await sb.commands.run(buildLsCommand(path))
      if (ls.exitCode === 0) return parseLsOutput(ls.stdout)
      // Neither GNU find nor `ls --time-style` (e.g. BusyBox/Alpine): last
      // resort is a pure-POSIX shell loop, parsed like find's output.
      const posix = await sb.commands.run(buildFallbackCommand(path))
      if (posix.exitCode === 0) return parseFindOutput(posix.stdout)
      const detail = (found.stderr || ls.stderr || posix.stderr || "").trim()
      throw new SandboxError(
        `Could not list ${path}${detail ? `: ${detail}` : ""}`,
      )
    },

    async pause(id) {
      const sb = await Sandbox.connect(id, conn)
      await sb.pause()
    },

    // connect() performs the activate/resume; that alone guarantees active.
    async resume(id) {
      const sb = await Sandbox.connect(id, conn)
      return {
        id: sb.id,
        name: sb.name,
        status: "active",
        metadata: sb.metadata,
        previewAccess: sb.previewAccess,
      }
    },

    async kill(id) {
      await Sandbox.killById(id, conn)
    },
  }
}
