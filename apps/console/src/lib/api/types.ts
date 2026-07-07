export type SandboxStatus = "active" | "paused" | "resuming" | "failed"

export interface NetworkConfig {
  allow_out?: string[]
  deny_out?: string[]
}

export interface SandboxListItem {
  id: string
  name: string
  status: SandboxStatus
  vcpu_count: number
  memory_mib: number
  snapshot_id?: string
  timeout_seconds?: number
  auto_delete_seconds?: number
  /** Deletion deadline; present only while paused with auto_delete_seconds set. */
  auto_delete_at?: string
  network?: NetworkConfig
  metadata: Record<string, string>
  created_at: string
}

export interface SandboxResponse extends SandboxListItem {
  access_token: string
  secrets?: SandboxSecretBindingSummary[]
}

/**
 * One env-var → secret binding on a sandbox. `revoked` flips true when the
 * underlying secret has been soft-deleted — the env var still holds the
 * (now-useless) proxy token and the daemon refuses to swap on use.
 */
export interface SandboxSecretBindingSummary {
  env_key: string
  secret_name: string
  revoked?: boolean
}

export interface ResumeResponse {
  id: string
  status: "active"
  access_token: string
}

export interface CreateSandboxRequest {
  name: string
  /** Template UUID or name to boot from. */
  from_template?: string
  from_snapshot?: string
  timeout_seconds?: number
  /** Delete the sandbox once continuously paused for this many seconds. */
  auto_delete_seconds?: number
  env_vars?: Record<string, string>
  /** env-var name → secret name. The agent sees a proxy token under env_key;
   *  the in-host daemon swaps it for the real value at egress. */
  secrets?: Record<string, string>
  metadata?: Record<string, string>
  network?: NetworkConfig
}

export interface SandboxPatch {
  network?: NetworkConfig
  metadata?: Record<string, string>
  /** A number (re)arms the window; null disarms it. */
  auto_delete_seconds?: number | null
  /** A number sets the auto-pause timeout; null disables it. */
  timeout_seconds?: number | null
}

export type SortDirection = "asc" | "desc"

/** Sort columns GET /sandboxes accepts; also the allowlist for URL ?sort=. */
export const SANDBOX_SORT_COLUMNS = ["created_at", "name", "status"] as const

export type SandboxSortColumn = (typeof SANDBOX_SORT_COLUMNS)[number]

/** Query params for the paginated sandbox list (GET /sandboxes). */
export interface SandboxListParams {
  /** 1-based page number. */
  page: number
  pageSize: number
  sort: SandboxSortColumn
  order: SortDirection
  /** Exact status filter (e.g. "active", "paused"); omit for all statuses. */
  status?: string
  /** Case-insensitive name substring search. */
  q?: string
}

export interface ApiKeyResponse {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
}

export interface CreateApiKeyResponse {
  id: string
  name: string
  key: string
  prefix: string
  created_at: string
}

export interface SnapshotResponse {
  id: string
  sandbox_id: string
  name: string | null
  size_bytes: number
  saved: boolean
  trigger: string
  created_at: string
}

export interface ActivityResponse {
  id: string
  /** Null for events not tied to a sandbox (e.g. secret CRUD). */
  sandbox_id: string | null
  category: string
  action: string
  status: string | null
  sandbox_name: string | null
  /** Set on secret events; secret_id is null once the secret is purged. */
  secret_id: string | null
  secret_name: string | null
  duration_ms: number | null
  error: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type TemplateStatus = "pending" | "building" | "ready" | "failed"

export type BuildStatus =
  | "pending"
  | "building"
  | "snapshotting"
  | "ready"
  | "failed"
  | "cancelled"

export interface BuildStepRun {
  run: string
}
export interface BuildStepCopy {
  copy: { src: string; dst: string }
}
export interface BuildStepEnv {
  env: { key: string; value: string }
}
export interface BuildStepWorkdir {
  workdir: string
}
export interface BuildStepUser {
  user: { name: string; sudo?: boolean }
}
export type BuildStep =
  | BuildStepRun
  | BuildStepCopy
  | BuildStepEnv
  | BuildStepWorkdir
  | BuildStepUser

export interface BuildSpec {
  from: string
  steps?: BuildStep[]
  start_cmd?: string
  ready_cmd?: string
}

export interface CreateTemplateRequest {
  name: string
  vcpu?: number
  memory_mib?: number
  disk_mib?: number
  build_spec: BuildSpec
}

export interface CreateTemplateResponse {
  id: string
  team_id: string
  name: string
  status: Exclude<TemplateStatus, "pending">
  vcpu: number
  memory_mib: number
  disk_mib: number
  created_at: string
  build_id: string
}

export interface TemplateResponse {
  id: string
  team_id: string
  name: string
  status: TemplateStatus
  vcpu: number
  memory_mib: number
  disk_mib: number
  size_bytes?: number
  error_message?: string
  created_at: string
  built_at?: string
}

export interface TemplateBuildResponse {
  id: string
  template_id: string
  status: BuildStatus
  build_spec_hash: string
  error_message?: string
  started_at?: string
  finalized_at?: string
  created_at: string
}

export type TemplateOwnerFilter = "all" | "team" | "system"

/** Sort columns GET /templates accepts; also the allowlist for URL ?sort=. */
export const TEMPLATE_SORT_COLUMNS = [
  "created_at",
  "name",
  "status",
  "size",
  "built_at",
] as const

export type TemplateSortColumn = (typeof TEMPLATE_SORT_COLUMNS)[number]

/** Query params for the paginated template list (GET /templates). */
export interface TemplateListParams {
  /** 1-based page number. */
  page: number
  pageSize: number
  sort: TemplateSortColumn
  order: SortDirection
  /** Which shelf to return: all (team + system), team-only, or system-only. */
  owner: TemplateOwnerFilter
  /** Case-insensitive name substring search. */
  q?: string
}

export interface BuildLogEvent {
  timestamp: string
  stream: "stdout" | "stderr" | "system"
  text: string
  finished?: boolean
  status?: "ready" | "failed" | "cancelled"
}

export type SecretAuthType =
  | "bearer"
  | "basic"
  | "api-key"
  | "custom"
  | "per_host"

export type AuditStatusFilter = "" | "2xx" | "3xx" | "4xx" | "5xx" | "errors"

/** One rule inside an auth.per_host config. */
export interface SecretPerHostRule {
  hosts: string[]
  type: "bearer" | "basic" | "api-key" | "custom"
  header?: string
  prefix?: string
  username?: string
  headers?: Record<string, string>
}

/** Single-rule auth shape: one type applied to every host in the allowlist. */
export interface SecretAuthConfigSingleRule {
  type: "bearer" | "basic" | "api-key" | "custom"
  header?: string
  prefix?: string
  username?: string
  headers?: Record<string, string>
}

/** Multi-rule auth: pick a rule by upstream host at egress. */
export interface SecretAuthConfigPerHost {
  per_host: SecretPerHostRule[]
}

export type SecretAuthConfig =
  | SecretAuthConfigSingleRule
  | SecretAuthConfigPerHost

export interface CreateSecretRequest {
  name: string
  value: string
  /** Mutually exclusive with `auth` + `hosts`. */
  provider?: string
  auth?: SecretAuthConfig
  hosts?: string[]
}

export interface UpdateSecretRequest {
  value: string
}

export interface SecretResponse {
  id: string
  name: string
  auth_type: SecretAuthType
  auth_config: Record<string, unknown>
  provider_shortcut?: string | null
  hosts: string[]
  created_at: string
  updated_at: string
  last_used_at?: string | null
}

export interface ProxyAuditEvent {
  id: number
  ts: string
  sandbox_id: string
  /** Populated by cross-sandbox views (`GET /secrets/{name}/audit`).
   *  Null when the referenced sandbox has been deleted. */
  sandbox_name?: string | null
  secret_id?: string
  method: string
  host: string
  path: string
  status: number
  upstream_status?: number
  latency_ms?: number
  error_code?: string
}

/** One row in the unified per-sandbox network log (`GET /sandboxes/{id}/network`).
 *  `kind` selects which fields are present: `connection` rows carry
 *  dst_ip/verdict/bytes; `request` rows carry method/path/status/secret_id. */
export interface NetworkEvent {
  kind: "connection" | "request"
  id: number
  ts: string
  host?: string

  // connection
  dst_ip?: string
  dst_port?: number
  verdict?: "allowed" | "blocked" | "failed"
  match_rule?: string
  bytes_sent?: number
  bytes_recv?: number

  // request
  method?: string
  path?: string
  status?: number
  upstream_status?: number
  latency_ms?: number
  secret_id?: string
  error_code?: string
}

export interface SecretSandboxBinding {
  sandbox_id: string
  sandbox_name: string
  env_key: string
  status: "active" | "paused" | "resuming" | "failed"
}

export interface ProviderShortcut {
  /** Stable identifier used as `provider` on POST /secrets. */
  name: string
  /** Human-readable label for pickers. */
  display: string
  auth_type: SecretAuthType
  auth_config: Record<string, unknown>
  hosts: string[]
  /** Prefix-shaped sample of the proxy token issued (e.g. "sk-ant-api03-..."). */
  token_shape: string
}
