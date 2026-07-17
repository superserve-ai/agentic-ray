/**
 * Core types for the Superserve SDK.
 *
 * These mirror the API response shapes with camelCase field names.
 * The SDK converts snake_case API responses to these types internally.
 */

import { SandboxError } from "./errors.js"

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export type SandboxStatus = "active" | "paused" | "resuming" | "failed"

/** Current preview-routing policy returned by the API. */
export type PreviewAccess = "legacy_public" | "public" | "private"

/** Strict preview policy callers can select at create/update time. */
export type PreviewAccessPolicy = Exclude<PreviewAccess, "legacy_public">

export interface NetworkConfig {
  allowOut?: string[]
  denyOut?: string[]
}

export interface SandboxInfo {
  id: string
  name: string
  status: SandboxStatus
  vcpuCount: number
  memoryMib: number
  createdAt: Date
  timeoutSeconds?: number
  /** Delete the sandbox after it has been continuously paused for this many seconds. */
  autoDeleteSeconds?: number
  /** When the sandbox will be auto-deleted. Present only while paused with `autoDeleteSeconds` set. */
  autoDeleteAt?: Date
  network?: NetworkConfig
  metadata: Record<string, string>
  /** Preview routing policy. `legacy_public` is returned for compatibility sandboxes. */
  previewAccess: PreviewAccess
  /** Secrets bound to this sandbox (env-var → secret), when any are attached. */
  secrets?: SandboxSecretBinding[]
}

// ---------------------------------------------------------------------------
// Sandbox Options
// ---------------------------------------------------------------------------

export interface ConnectionOptions {
  apiKey?: string
  baseUrl?: string
  signal?: AbortSignal
}

export interface SandboxCreateOptions extends ConnectionOptions {
  name: string
  /** Template name, UUID, or Template instance. */
  fromTemplate?: string | { name?: string; id: string }
  /** Snapshot UUID. */
  fromSnapshot?: string
  timeoutSeconds?: number
  /**
   * Delete the sandbox once it has been continuously paused for this
   * many seconds. The window arms on every pause and is cancelled by resume;
   * `0` deletes as soon as the sandbox pauses. Omit to keep paused
   * sandboxes forever (the default).
   */
  autoDeleteSeconds?: number
  metadata?: Record<string, string>
  envVars?: Record<string, string>
  /**
   * Bind team-stored secrets to environment variables: `{ ENV_VAR: secretName }`.
   * The agent sees a proxy token under each env var; the in-host daemon swaps it
   * for the real credential at egress. Create secrets with `Secret.create()`.
   */
  secrets?: Record<string, string>
  network?: NetworkConfig
  /**
   * Opt into explicit preview publication. Both values require a published
   * port; `private` additionally requires that port's token. Omit to preserve
   * legacy all-port routing for older clients.
   */
  previewAccess?: PreviewAccessPolicy
}

export interface SandboxListOptions extends ConnectionOptions {
  metadata?: Record<string, string>
}

export interface SandboxUpdateOptions {
  metadata?: Record<string, string>
  network?: NetworkConfig
  /**
   * Set or clear the auto-delete window. A number (re)arms it — on an
   * already-paused sandbox the countdown starts now, never retroactively.
   * `null` disables auto-delete; `undefined` leaves it unchanged.
   */
  autoDeleteSeconds?: number | null
  /**
   * Set or clear the auto-pause timeout. `null` disables auto-pause;
   * `undefined` leaves it unchanged.
   */
  timeoutSeconds?: number | null
  /** Move the sandbox onto a strict public/private preview policy. */
  previewAccess?: PreviewAccessPolicy
}

export interface PublishedPreviewPort {
  port: number
  tokenVersion: number
}

export interface PreviewPortList {
  previewAccess: PreviewAccess
  ports: PublishedPreviewPort[]
}

export interface PreviewTokenOptions {
  /** Token lifetime in seconds (1–604800). Omit to live until rotation. */
  expiresInSeconds?: number
}

export interface SignedPreviewUrlOptions {
  /** Signed-link lifetime in seconds. Defaults to 60. */
  expiresInSeconds?: number
}

export interface PreviewToken {
  token: string
  port: number
  header: string
  queryParam: string
  tokenVersion: number
  previewAccess: PreviewAccess
  expiresAt?: Date
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface CommandOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  onStdout?: (data: string) => void
  onStderr?: (data: string) => void
  signal?: AbortSignal
  /**
   * Cap (bytes) on the response buffered by a non-streaming `run()`. Defaults to
   * 10 MiB (`MAX_EXEC_RESPONSE_BYTES`). Exceeding it throws `ValidationError`
   * rather than buffering unbounded output from an untrusted sandbox. For
   * genuinely large output, stream via `onStdout`/`onStderr`.
   */
  maxOutputBytes?: number
}

export interface SpawnOptions {
  cwd?: string
  env?: Record<string, string>
  /** Per-command timeout. Omit for no timeout — interactive processes are long-lived. */
  timeoutMs?: number
  /** Called with decoded stdout text as it streams. */
  onStdout?: (data: string) => void
  /** Called with decoded stderr text as it streams. */
  onStderr?: (data: string) => void
  /** Abort to kill the process and close the connection. */
  signal?: AbortSignal
}

/** Write to and close a running process's stdin. */
export interface CommandStdin {
  /** Write to stdin. Strings are UTF-8 encoded; bytes are sent as-is. */
  write(data: string | Uint8Array): void
  /** Close stdin, signalling EOF. */
  close(): void
}

/**
 * A live, full-duplex handle to a running command (returned by
 * `commands.spawn`). Stream output via the `onStdout`/`onStderr` options,
 * write to `stdin`, `kill` it, and `wait` for the exit result.
 */
export interface CommandSession {
  /** Write to / close the process's stdin. */
  readonly stdin: CommandStdin
  /** Send a POSIX signal to the process (default `"SIGTERM"`). */
  kill(signal?: string): void
  /**
   * Resolve with the final result when the process exits. Rejects if the
   * connection drops before the process finishes.
   */
  wait(): Promise<CommandResult>
  /** Kill the process and close the connection. */
  close(): Promise<void>
  /** Alias of `close()`, enabling `await using`. */
  [Symbol.asyncDispose](): Promise<void>
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export type FileInput = string | Uint8Array | ArrayBuffer | Blob

// ---------------------------------------------------------------------------
// Internal: API response shapes (snake_case, as returned by the API)
// ---------------------------------------------------------------------------

/** @internal */
export interface ApiSandboxResponse {
  id?: string
  name?: string
  status?: string
  vcpu_count?: number
  memory_mib?: number
  access_token?: string
  created_at?: string
  timeout_seconds?: number
  auto_delete_seconds?: number
  auto_delete_at?: string
  network?: { allow_out?: string[]; deny_out?: string[] }
  metadata?: Record<string, string>
  preview_access?: string
  secrets?: Array<{
    env_key?: string
    secret_name?: string
    revoked?: boolean
  }>
}

/** @internal Response shape from POST /sandboxes/{id}/resume. */
export interface ApiResumeResponse {
  id?: string
  status?: string
  access_token?: string
}

/** @internal */
export interface ApiExecResult {
  stdout?: string
  stderr?: string
  exit_code?: number
}

/** @internal */
export interface ApiExecStreamEvent {
  timestamp?: string
  stdout?: string
  stderr?: string
  exit_code?: number
  finished?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @internal Convert an API sandbox response to a SandboxInfo.
 *
 * Requires only `id` and `status`. The raw `access_token` is surfaced only
 * on create + get-by-id and is tracked privately on the `sandbox` -
 * it is not part of SandboxInfo.
 */
export function toSandboxInfo(raw: ApiSandboxResponse): SandboxInfo {
  if (!raw.id) {
    throw new SandboxError("Invalid API response: missing sandbox id")
  }
  if (!raw.status) {
    throw new SandboxError("Invalid API response: missing sandbox status")
  }
  if (!raw.created_at) {
    throw new SandboxError("Invalid API response: missing created_at")
  }

  return {
    id: raw.id,
    name: raw.name ?? "",
    status: raw.status as SandboxStatus,
    vcpuCount: raw.vcpu_count ?? 0,
    memoryMib: raw.memory_mib ?? 0,
    createdAt: new Date(raw.created_at),
    timeoutSeconds: raw.timeout_seconds ?? undefined,
    autoDeleteSeconds: raw.auto_delete_seconds ?? undefined,
    autoDeleteAt: raw.auto_delete_at ? new Date(raw.auto_delete_at) : undefined,
    network: raw.network
      ? { allowOut: raw.network.allow_out, denyOut: raw.network.deny_out }
      : undefined,
    metadata: raw.metadata ?? {},
    previewAccess: (raw.preview_access ?? "legacy_public") as PreviewAccess,
    secrets: raw.secrets?.map((s) => ({
      envKey: s.env_key ?? "",
      secretName: s.secret_name ?? "",
      revoked: s.revoked,
    })),
  }
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export type TemplateStatus = "pending" | "building" | "ready" | "failed"

export type TemplateBuildStatus =
  | "pending"
  | "building"
  | "snapshotting"
  | "ready"
  | "failed"
  | "cancelled"

export type BuildLogStream = "stdout" | "stderr" | "system"

export interface TemplateInfo {
  id: string
  name: string
  teamId: string
  status: TemplateStatus
  vcpu: number
  memoryMib: number
  diskMib: number
  sizeBytes?: number
  errorMessage?: string
  createdAt: Date
  builtAt?: Date
  latestBuildId?: string
}

export interface TemplateBuildInfo {
  id: string
  templateId: string
  status: TemplateBuildStatus
  buildSpecHash: string
  errorMessage?: string
  startedAt?: Date
  finalizedAt?: Date
  createdAt: Date
}

export interface BuildLogEvent {
  timestamp: Date
  stream: BuildLogStream
  text: string
  finished?: boolean
  status?: "ready" | "failed" | "cancelled"
}

// Discriminated union: exactly one of the four fields is present.
export type BuildStep =
  | { run: string }
  | { env: { key: string; value: string } }
  | { workdir: string }
  | { user: { name: string; sudo?: boolean } }

export interface TemplateCreateOptions extends ConnectionOptions {
  name: string
  vcpu?: number
  memoryMib?: number
  diskMib?: number
  from: string
  steps?: BuildStep[]
  startCmd?: string
  readyCmd?: string
}

export interface TemplateListOptions extends ConnectionOptions {
  namePrefix?: string
}

export interface TemplateBuildsListOptions extends ConnectionOptions {
  limit?: number
}

export interface BuildLogsOptions {
  onEvent: (ev: BuildLogEvent) => void
  buildId?: string
  signal?: AbortSignal
}

export interface WaitUntilReadyOptions {
  onLog?: (ev: BuildLogEvent) => void
  signal?: AbortSignal
  pollIntervalMs?: number
}

// ---------------------------------------------------------------------------
// Internal: Template API shapes
// ---------------------------------------------------------------------------

/** @internal */
export interface ApiTemplateResponse {
  id?: string
  team_id?: string
  name?: string
  status?: string
  vcpu?: number
  memory_mib?: number
  disk_mib?: number
  size_bytes?: number
  error_message?: string
  created_at?: string
  built_at?: string
  latest_build_id?: string
}

/** @internal */
export interface ApiTemplateBuildResponse {
  id?: string
  template_id?: string
  status?: string
  build_spec_hash?: string
  error_message?: string
  started_at?: string
  finalized_at?: string
  created_at?: string
}

/** @internal */
export interface ApiCreateTemplateResponse extends ApiTemplateResponse {
  build_id?: string
}

/** @internal */
export interface ApiBuildLogEvent {
  timestamp?: string
  stream?: string
  text?: string
  finished?: boolean
  status?: string
}

// ---------------------------------------------------------------------------
// Template converters
// ---------------------------------------------------------------------------

export function toTemplateInfo(
  raw: ApiTemplateResponse,
  latestBuildId?: string,
): TemplateInfo {
  if (!raw.id) {
    throw new SandboxError("Invalid API response: missing template id")
  }
  if (!raw.name) {
    throw new SandboxError("Invalid API response: missing template name")
  }
  if (!raw.status) {
    throw new SandboxError("Invalid API response: missing template status")
  }
  if (!raw.team_id) {
    throw new SandboxError("Invalid API response: missing team_id")
  }
  if (!raw.created_at) {
    throw new SandboxError("Invalid API response: missing created_at")
  }

  return {
    id: raw.id,
    name: raw.name,
    teamId: raw.team_id,
    status: raw.status as TemplateStatus,
    vcpu: raw.vcpu ?? 0,
    memoryMib: raw.memory_mib ?? 0,
    diskMib: raw.disk_mib ?? 0,
    sizeBytes: raw.size_bytes,
    errorMessage: raw.error_message,
    createdAt: new Date(raw.created_at),
    builtAt: raw.built_at ? new Date(raw.built_at) : undefined,
    latestBuildId: latestBuildId ?? raw.latest_build_id,
  }
}

export function toTemplateBuildInfo(
  raw: ApiTemplateBuildResponse,
): TemplateBuildInfo {
  if (!raw.id) {
    throw new SandboxError("Invalid API response: missing build id")
  }
  if (!raw.template_id) {
    throw new SandboxError("Invalid API response: missing template_id")
  }
  if (!raw.status) {
    throw new SandboxError("Invalid API response: missing build status")
  }
  if (!raw.build_spec_hash) {
    throw new SandboxError("Invalid API response: missing build_spec_hash")
  }
  if (!raw.created_at) {
    throw new SandboxError("Invalid API response: missing created_at")
  }

  return {
    id: raw.id,
    templateId: raw.template_id,
    status: raw.status as TemplateBuildStatus,
    buildSpecHash: raw.build_spec_hash,
    errorMessage: raw.error_message,
    startedAt: raw.started_at ? new Date(raw.started_at) : undefined,
    finalizedAt: raw.finalized_at ? new Date(raw.finalized_at) : undefined,
    createdAt: new Date(raw.created_at),
  }
}

export function toBuildLogEvent(raw: ApiBuildLogEvent): BuildLogEvent {
  if (!raw.timestamp) {
    throw new SandboxError("Invalid log event: missing timestamp")
  }
  if (!raw.stream) {
    throw new SandboxError("Invalid log event: missing stream")
  }

  return {
    timestamp: new Date(raw.timestamp),
    stream: raw.stream as BuildLogStream,
    text: raw.text ?? "",
    finished: raw.finished,
    status: raw.status as BuildLogEvent["status"],
  }
}

/**
 * Pass-through for build steps since camelCase structure matches the API.
 * Kept as a function for future normalization (e.g. defaulting sudo).
 */
export function buildStepsToApi(steps: BuildStep[]): unknown[] {
  return [...steps]
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export type SecretAuthType =
  | "bearer"
  | "basic"
  | "api-key"
  | "custom"
  | "per_host"

/**
 * One auth rule — how the credential is attached to an outbound request:
 * - `bearer`  → `Authorization: Bearer <value>`
 * - `basic`   → HTTP Basic, `<username>:<value>`
 * - `api-key` → a named header, `<header>: <prefix><value>`
 * - `custom`  → arbitrary header templates referencing `{{ value }}`
 */
export interface SecretAuthRule {
  type: "bearer" | "basic" | "api-key" | "custom"
  /** Header name for `api-key` (e.g. `"x-api-key"`). */
  header?: string
  /** Value prefix for `api-key` (e.g. `"Token "`). */
  prefix?: string
  /** Username for `basic`; the secret value is the password. */
  username?: string
  /** Header templates for `custom`; each value may reference `{{ value }}`. */
  headers?: Record<string, string>
}

/** Per-host auth — pick a rule by upstream host at egress. */
export interface SecretAuthPerHost {
  perHost: Array<SecretAuthRule & { hosts: string[] }>
}

/** Custom auth config: a single rule applied to every host, or per-host rules. */
export type SecretAuth = SecretAuthRule | SecretAuthPerHost

export interface SecretInfo {
  id: string
  name: string
  authType: SecretAuthType
  authConfig: Record<string, unknown>
  /** Set when created from a provider shortcut (e.g. `"anthropic"`). */
  providerShortcut?: string
  hosts: string[]
  createdAt: Date
  updatedAt: Date
  lastUsedAt?: Date
}

export interface SecretCreateOptions extends ConnectionOptions {
  name: string
  /** The credential to protect. It never leaves the platform in cleartext. */
  value: string
  /**
   * A built-in provider shortcut (e.g. `"anthropic"`) — see `Provider.list()`.
   * Mutually exclusive with `auth` + `hosts`.
   */
  provider?: string
  /** Custom auth config. Requires `hosts`. Mutually exclusive with `provider`. */
  auth?: SecretAuth
  /** Upstream hosts the credential may be used with. Required with `auth`. */
  hosts?: string[]
}

export type SecretListOptions = ConnectionOptions

export type AuditStatusFilter = "2xx" | "3xx" | "4xx" | "5xx" | "errors"

export interface SecretAuditOptions extends ConnectionOptions {
  limit?: number
  /** Cursor — return events older than this event id. */
  before?: number
  /** Filter by HTTP status class, or `"errors"` for proxy-level failures. */
  status?: AuditStatusFilter
}

/** One request made with a secret attached (`Secret.getAudit()`). */
export interface ProxyAuditEvent {
  id: number
  ts: Date
  sandboxId: string
  /** Null when the referenced sandbox has been deleted. */
  sandboxName?: string
  secretId?: string
  method: string
  host: string
  path: string
  status: number
  upstreamStatus?: number
  latencyMs?: number
  errorCode?: string
}

/** A sandbox a secret is bound to (`Secret.getSandboxes()`). */
export interface SecretSandboxBinding {
  sandboxId: string
  sandboxName: string
  envKey: string
  status: SandboxStatus
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** A built-in provider shortcut (`Provider.list()`). */
export interface ProviderShortcut {
  /** Stable identifier passed as `provider` to `Secret.create()`. */
  name: string
  /** Human-readable label. */
  display: string
  authType: SecretAuthType
  authConfig: Record<string, unknown>
  hosts: string[]
  /** Prefix-shaped sample of the proxy token issued (e.g. `"sk-ant-api03-..."`). */
  tokenShape: string
}

// ---------------------------------------------------------------------------
// Network log
// ---------------------------------------------------------------------------

export type NetworkVerdict = "allowed" | "blocked" | "failed"

/**
 * One row in a sandbox's network log (`sandbox.getNetworkLog()`). `kind`
 * selects which fields are present: `connection` rows carry
 * `dstIp`/`verdict`/byte counts; `request` rows carry `method`/`path`/`status`
 * and the `secretId` injected (when a secret was used).
 */
export interface NetworkEvent {
  kind: "connection" | "request"
  id: number
  ts: Date
  host?: string

  // connection
  dstIp?: string
  dstPort?: number
  verdict?: NetworkVerdict
  matchRule?: string
  bytesSent?: number
  bytesRecv?: number

  // request
  method?: string
  path?: string
  status?: number
  upstreamStatus?: number
  latencyMs?: number
  secretId?: string
  errorCode?: string
}

/** A page of network events plus its pagination cursor. */
export interface NetworkLogPage {
  events: NetworkEvent[]
  /** Pass as `before` to fetch the next page; undefined when `hasMore` is false. */
  nextCursor?: string
  hasMore: boolean
}

export interface NetworkLogOptions extends ConnectionOptions {
  limit?: number
  /** Return rows strictly older than this RFC3339 timestamp. Also the page cursor. */
  before?: string
  /** Return rows at or newer than this RFC3339 timestamp. */
  since?: string
  /** Filter to connections with this verdict (excludes request rows). */
  verdict?: NetworkVerdict
}

/** One env-var → secret binding on a sandbox. */
export interface SandboxSecretBinding {
  envKey: string
  secretName: string
  /** True when the underlying secret was deleted; the proxy token no longer resolves. */
  revoked?: boolean
}

// ---------------------------------------------------------------------------
// Internal: Secrets / Providers / Network API shapes
// ---------------------------------------------------------------------------

/** @internal */
export interface ApiSecretResponse {
  id?: string
  name?: string
  auth_type?: string
  auth_config?: Record<string, unknown>
  provider_shortcut?: string | null
  hosts?: string[]
  created_at?: string
  updated_at?: string
  last_used_at?: string | null
}

/** @internal */
export interface ApiProviderShortcut {
  name?: string
  display?: string
  auth_type?: string
  auth_config?: Record<string, unknown>
  hosts?: string[]
  token_shape?: string
}

/** @internal */
export interface ApiProxyAuditEvent {
  id?: number
  ts?: string
  sandbox_id?: string
  sandbox_name?: string | null
  secret_id?: string
  method?: string
  host?: string
  path?: string
  status?: number
  upstream_status?: number
  latency_ms?: number
  error_code?: string
}

/** @internal */
export interface ApiSecretSandbox {
  sandbox_id?: string
  sandbox_name?: string
  env_key?: string
  status?: string
}

/** @internal */
export interface ApiNetworkEvent {
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

/** @internal */
export interface ApiNetworkPage {
  data?: ApiNetworkEvent[]
  next_cursor?: string | null
  has_more?: boolean
}

// ---------------------------------------------------------------------------
// Secrets / Providers / Network converters
// ---------------------------------------------------------------------------

export function toSecretInfo(raw: ApiSecretResponse): SecretInfo {
  if (!raw.id) {
    throw new SandboxError("Invalid API response: missing secret id")
  }
  if (!raw.name) {
    throw new SandboxError("Invalid API response: missing secret name")
  }
  if (!raw.auth_type) {
    throw new SandboxError("Invalid API response: missing auth_type")
  }
  if (!raw.created_at) {
    throw new SandboxError("Invalid API response: missing created_at")
  }
  return {
    id: raw.id,
    name: raw.name,
    authType: raw.auth_type as SecretAuthType,
    authConfig: raw.auth_config ?? {},
    providerShortcut: raw.provider_shortcut ?? undefined,
    hosts: raw.hosts ?? [],
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at ?? raw.created_at),
    lastUsedAt: raw.last_used_at ? new Date(raw.last_used_at) : undefined,
  }
}

/** @internal Build the POST /secrets body from create options. */
export function secretCreateBody(
  options: SecretCreateOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: options.name,
    value: options.value,
  }
  if (options.provider !== undefined) {
    body.provider = options.provider
  }
  if (options.auth !== undefined) {
    body.auth =
      "perHost" in options.auth
        ? { per_host: options.auth.perHost }
        : options.auth
  }
  if (options.hosts !== undefined) {
    body.hosts = options.hosts
  }
  return body
}

export function toProviderShortcut(raw: ApiProviderShortcut): ProviderShortcut {
  if (!raw.name) {
    throw new SandboxError("Invalid API response: missing provider name")
  }
  return {
    name: raw.name,
    display: raw.display ?? raw.name,
    authType: (raw.auth_type ?? "bearer") as SecretAuthType,
    authConfig: raw.auth_config ?? {},
    hosts: raw.hosts ?? [],
    tokenShape: raw.token_shape ?? "",
  }
}

export function toProxyAuditEvent(raw: ApiProxyAuditEvent): ProxyAuditEvent {
  if (raw.id === undefined) {
    throw new SandboxError("Invalid audit event: missing id")
  }
  if (!raw.ts) {
    throw new SandboxError("Invalid audit event: missing ts")
  }
  return {
    id: raw.id,
    ts: new Date(raw.ts),
    sandboxId: raw.sandbox_id ?? "",
    sandboxName: raw.sandbox_name ?? undefined,
    secretId: raw.secret_id,
    method: raw.method ?? "",
    host: raw.host ?? "",
    path: raw.path ?? "",
    status: raw.status ?? 0,
    upstreamStatus: raw.upstream_status,
    latencyMs: raw.latency_ms,
    errorCode: raw.error_code,
  }
}

export function toSecretSandboxBinding(
  raw: ApiSecretSandbox,
): SecretSandboxBinding {
  return {
    sandboxId: raw.sandbox_id ?? "",
    sandboxName: raw.sandbox_name ?? "",
    envKey: raw.env_key ?? "",
    status: (raw.status ?? "active") as SandboxStatus,
  }
}

export function toNetworkEvent(raw: ApiNetworkEvent): NetworkEvent {
  if (raw.id === undefined) {
    throw new SandboxError("Invalid network event: missing id")
  }
  if (!raw.kind) {
    throw new SandboxError("Invalid network event: missing kind")
  }
  if (!raw.ts) {
    throw new SandboxError("Invalid network event: missing ts")
  }
  return {
    kind: raw.kind as NetworkEvent["kind"],
    id: raw.id,
    ts: new Date(raw.ts),
    host: raw.host,
    dstIp: raw.dst_ip,
    dstPort: raw.dst_port,
    verdict: raw.verdict as NetworkVerdict | undefined,
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

export function toNetworkLogPage(raw: ApiNetworkPage): NetworkLogPage {
  return {
    events: (raw.data ?? []).map(toNetworkEvent),
    nextCursor: raw.next_cursor ?? undefined,
    hasMore: raw.has_more ?? false,
  }
}
