/**
 * Main Sandbox class — the primary entry point for the Superserve SDK.
 *
 * Static factory methods (create/connect) return a `sandbox`. Call methods on
 * it directly (`sandbox.commands.run(...)`, `sandbox.files.write(...)`, etc.).
 *
 * ```typescript
 * import { Sandbox } from "@superserve/sdk"
 *
 * const sandbox = await Sandbox.create({ name: "my-sandbox" })
 * const result = await sandbox.commands.run("echo hello")
 * await sandbox.files.write("/app/data.txt", "content")
 * await sandbox.kill()
 * ```
 */

import { Commands } from "./commands.js"
import { previewUrl, type ResolvedConfig, resolveConfig } from "./config.js"
import { NotFoundError, SandboxError } from "./errors.js"
import { Files } from "./files.js"
import { request, requestVoid } from "./http.js"
import type {
  ApiNetworkPage,
  ApiSandboxResponse,
  ConnectionOptions,
  NetworkLogOptions,
  NetworkLogPage,
  PreviewPortList,
  PreviewToken,
  PreviewTokenOptions,
  PublishedPreviewPort,
  SandboxCreateOptions,
  SandboxInfo,
  SandboxListOptions,
  SandboxSecretBinding,
  SandboxStatus,
  SandboxUpdateOptions,
  SignedPreviewUrlOptions,
} from "./types.js"
import { toNetworkLogPage, toSandboxInfo } from "./types.js"

export class Sandbox {
  /** Unique sandbox ID (UUID). */
  readonly id: string

  /** Human-readable sandbox name. */
  readonly name: string

  /** Sandbox status at construction time. Call getInfo() for the current status. */
  readonly status: SandboxStatus

  /** User-supplied metadata tags at construction time. Call getInfo() to refresh. */
  readonly metadata: Record<string, string>

  /** Preview policy at construction time. Call getInfo() to refresh. */
  readonly previewAccess: SandboxInfo["previewAccess"]

  /**
   * Secrets bound to this sandbox (env-var → secret) at construction time,
   * when any were attached. Call getInfo() to refresh.
   */
  readonly secrets?: SandboxSecretBinding[]

  /** Execute shell commands inside this sandbox. */
  readonly commands: Commands

  /**
   * Upload and download files to/from this sandbox.
   *
   * Reads the per-sandbox access token live, so a `resume()` or an auto-resume
   * (rotating the token) is picked up transparently.
   */
  readonly files: Files

  private _accessToken: string
  private _refreshInFlight: Promise<string> | null = null
  private readonly _config: ResolvedConfig

  /** @internal — Use Sandbox.create() or Sandbox.connect() instead. */
  private constructor(
    info: SandboxInfo,
    accessToken: string,
    config: ResolvedConfig,
  ) {
    this.id = info.id
    this.name = info.name
    this.status = info.status
    this.metadata = info.metadata
    this.previewAccess = info.previewAccess
    this.secrets = info.secrets
    this._accessToken = accessToken
    this._config = config

    this.commands = new Commands({
      sandboxId: this.id,
      sandboxHost: config.sandboxHost,
      getAccessToken: () => this._accessToken,
      refreshActivate: () => this._refreshActivate(),
    })
    this.files = new Files({
      sandboxId: this.id,
      sandboxHost: config.sandboxHost,
      getAccessToken: () => this._accessToken,
      refreshActivate: () => this._refreshActivate(),
    })
  }

  /**
   * POST a token-rotating endpoint (`/resume` or `/activate`) and update the
   * cached token. `commands` and `files` read the token live, so they pick up
   * the rotation transparently. Returns the new token. @internal
   */
  private async _postAndRotateToken(
    endpoint: "resume" | "activate",
  ): Promise<string> {
    const raw = await request<ApiSandboxResponse>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/${endpoint}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    if (!raw.access_token) {
      throw new SandboxError(
        `Invalid API response from POST /sandboxes/${this.id}/${endpoint}: missing access_token`,
      )
    }
    this._accessToken = raw.access_token
    return this._accessToken
  }

  /**
   * Slow-path fallback for data-plane AuthenticationError. Coalesces
   * concurrent callers onto a single in-flight POST /activate so a
   * paused-sandbox resume isn't claimed twice (the loser gets 409). @internal
   */
  private _refreshActivate(): Promise<string> {
    if (this._refreshInFlight) return this._refreshInFlight
    this._refreshInFlight = this._postAndRotateToken("activate").finally(() => {
      this._refreshInFlight = null
    })
    return this._refreshInFlight
  }

  // -------------------------------------------------------------------------
  // Static factory methods
  // -------------------------------------------------------------------------

  /**
   * Create a new sandbox and return a ready-to-use `sandbox`.
   *
   * The request is synchronous: once it resolves, the sandbox is `active`
   * and ready to execute commands and file operations.
   *
   * @example
   * ```typescript
   * const sandbox = await Sandbox.create({ name: "my-sandbox" })
   * const result = await sandbox.commands.run("echo hello")
   * ```
   */
  static async create(options: SandboxCreateOptions): Promise<Sandbox> {
    const config = resolveConfig(options)

    const body: Record<string, unknown> = { name: options.name }
    if (options.timeoutSeconds !== undefined)
      body.timeout_seconds = options.timeoutSeconds
    if (options.autoDeleteSeconds !== undefined)
      body.auto_delete_seconds = options.autoDeleteSeconds
    if (options.fromTemplate !== undefined) {
      body.from_template =
        typeof options.fromTemplate === "string"
          ? options.fromTemplate
          : (options.fromTemplate.name ?? options.fromTemplate.id)
    }
    if (options.fromSnapshot !== undefined) {
      body.from_snapshot = options.fromSnapshot
    }
    if (options.metadata !== undefined) body.metadata = options.metadata
    if (options.envVars !== undefined) body.env_vars = options.envVars
    if (options.secrets !== undefined) body.secrets = options.secrets
    if (options.network) {
      body.network = {
        allow_out: options.network.allowOut,
        deny_out: options.network.denyOut,
      }
    }
    if (options.previewAccess !== undefined)
      body.preview_access = options.previewAccess

    const raw = await request<ApiSandboxResponse>({
      method: "POST",
      url: `${config.baseUrl}/sandboxes`,
      headers: { "X-API-Key": config.apiKey },
      body,
      signal: options.signal,
    })

    if (!raw.access_token) {
      throw new SandboxError(
        "Invalid API response from POST /sandboxes: missing access_token",
      )
    }
    return new Sandbox(toSandboxInfo(raw), raw.access_token, config)
  }

  /**
   * Connect to an existing sandbox by ID.
   *
   * Calls `POST /activate` so the returned instance is guaranteed to be
   * active (paused sandboxes are auto-resumed) with a fresh access token.
   *
   * @example
   * ```typescript
   * const sandbox = await Sandbox.connect("sandbox-uuid")
   * ```
   */
  static async connect(
    sandboxId: string,
    options: ConnectionOptions = {},
  ): Promise<Sandbox> {
    const config = resolveConfig(options)

    const raw = await request<ApiSandboxResponse>({
      method: "POST",
      url: `${config.baseUrl}/sandboxes/${sandboxId}/activate`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })

    if (!raw.access_token) {
      throw new SandboxError(
        `Invalid API response from POST /sandboxes/${sandboxId}/activate: missing access_token`,
      )
    }
    return new Sandbox(toSandboxInfo(raw), raw.access_token, config)
  }

  /**
   * List all sandboxes belonging to the authenticated team.
   *
   * @param options.metadata — Filter by metadata key-value pairs.
   *
   * @example
   * ```typescript
   * const sandboxes = await Sandbox.list()
   * const prodBoxes = await Sandbox.list({ metadata: { env: "prod" } })
   * ```
   */
  static async list(options: SandboxListOptions = {}): Promise<SandboxInfo[]> {
    const config = resolveConfig(options)

    let url = `${config.baseUrl}/sandboxes`
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(options.metadata)) {
        params.set(`metadata.${key}`, value)
      }
      url += `?${params.toString()}`
    }

    const raw = await request<ApiSandboxResponse[]>({
      method: "GET",
      url,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })

    return raw.map(toSandboxInfo)
  }

  /**
   * Delete a sandbox by ID.
   *
   * Idempotent: if the sandbox is already deleted, this is a no-op.
   */
  static async killById(
    sandboxId: string,
    options: ConnectionOptions = {},
  ): Promise<void> {
    const config = resolveConfig(options)
    try {
      await requestVoid({
        method: "DELETE",
        url: `${config.baseUrl}/sandboxes/${sandboxId}`,
        headers: { "X-API-Key": config.apiKey },
        signal: options.signal,
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }

  /**
   * Update a sandbox by ID without holding a live instance.
   *
   * Unlike `connect(id).then(s => s.update(...))`, this does not activate the
   * sandbox — a paused sandbox stays paused. Use it to change `metadata`,
   * `network`, `autoDeleteSeconds`, or `timeoutSeconds` from just an ID.
   * Pass `null` for `autoDeleteSeconds` / `timeoutSeconds` to clear them.
   */
  static async updateById(
    sandboxId: string,
    options: SandboxUpdateOptions,
    connection: ConnectionOptions = {},
  ): Promise<void> {
    const config = resolveConfig(connection)
    await requestVoid({
      method: "PATCH",
      url: `${config.baseUrl}/sandboxes/${sandboxId}`,
      headers: { "X-API-Key": config.apiKey },
      body: Sandbox.buildUpdateBody(options),
      signal: connection.signal,
    })
  }

  // -------------------------------------------------------------------------
  // Instance lifecycle methods
  // -------------------------------------------------------------------------

  /**
   * Refresh this sandbox's info from the API and return the fresh data.
   *
   * Note: the returned SandboxInfo reflects the current state. The sandbox
   * instance's own `status` / `metadata` properties are snapshots from
   * construction and are not mutated — use the return value.
   */
  async getInfo(): Promise<SandboxInfo> {
    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${this._config.baseUrl}/sandboxes/${this.id}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toSandboxInfo(raw)
  }

  /**
   * Pause this sandbox. The sandbox transitions to `paused`.
   * All running processes and file state are preserved.
   */
  async pause(): Promise<void> {
    await requestVoid({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/pause`,
      headers: { "X-API-Key": this._config.apiKey },
    })
  }

  /**
   * Resume a paused sandbox. Status transitions back to `active`.
   * The access token is rotated; `sandbox.commands` and `sandbox.files` pick
   * up the fresh token transparently.
   */
  async resume(): Promise<void> {
    await this._postAndRotateToken("resume")
  }

  /**
   * Delete this sandbox and all its resources.
   *
   * Idempotent: if the sandbox is already deleted, this is a no-op.
   */
  async kill(): Promise<void> {
    try {
      await requestVoid({
        method: "DELETE",
        url: `${this._config.baseUrl}/sandboxes/${this.id}`,
        headers: { "X-API-Key": this._config.apiKey },
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
    // Note: can't mutate status (it's readonly). The sandbox is logically deleted.
  }

  /**
   * Partially update this sandbox (metadata, network rules, auto-delete,
   * timeout).
   *
   * `autoDeleteSeconds: null` clears the auto-delete window; a number sets
   * it, counting from now when the sandbox is already paused.
   * `timeoutSeconds: null` clears the auto-pause timeout.
   */
  async update(options: SandboxUpdateOptions): Promise<void> {
    await requestVoid({
      method: "PATCH",
      url: `${this._config.baseUrl}/sandboxes/${this.id}`,
      headers: { "X-API-Key": this._config.apiKey },
      body: Sandbox.buildUpdateBody(options),
    })
  }

  /** Serialize update options to the wire body (snake_case, null preserved). */
  private static buildUpdateBody(
    options: SandboxUpdateOptions,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {}
    if (options.metadata !== undefined) body.metadata = options.metadata
    if (options.autoDeleteSeconds !== undefined)
      body.auto_delete_seconds = options.autoDeleteSeconds
    if (options.timeoutSeconds !== undefined)
      body.timeout_seconds = options.timeoutSeconds
    if (options.network !== undefined) {
      body.network = {
        allow_out: options.network.allowOut,
        deny_out: options.network.denyOut,
      }
    }
    if (options.previewAccess !== undefined)
      body.preview_access = options.previewAccess
    return body
  }

  /**
   * Build the preview URL for a port running inside this sandbox.
   *
   * This is pure string construction. Under strict public/private policies,
   * publish the port first; private URLs also need a header token or a signed
   * URL from `getSignedPreviewUrl()`.
   *
   * @throws {ValidationError} if `port` is not an integer in [1024, 65535].
   *
   * @example
   * ```typescript
   * await sandbox.commands.spawn("python3 -m http.server 8000")
   * const url = sandbox.getPreviewUrl(8000)
   * ```
   */
  getPreviewUrl(port: number): string {
    return previewUrl(this.id, this._config.sandboxHost, port)
  }

  /** List the sandbox's explicitly published preview ports and policy. */
  async listPreviewPorts(): Promise<PreviewPortList> {
    const raw = await request<{
      preview_access?: string
      ports?: Array<{ port?: number; token_version?: number }>
    }>({
      method: "GET",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/preview-ports`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    const ports = (raw.ports ?? []).map((item) => {
      if (item.port === undefined || item.token_version === undefined) {
        throw new SandboxError("Invalid list-preview-ports response")
      }
      return {
        port: item.port,
        tokenVersion: item.token_version,
      }
    })
    return {
      previewAccess: (raw.preview_access ??
        "legacy_public") as PreviewPortList["previewAccess"],
      ports,
    }
  }

  /** Publish a port. Idempotent; an existing token generation is preserved. */
  async publishPreviewPort(port: number): Promise<PublishedPreviewPort> {
    this.getPreviewUrl(port) // validate against the shared proxy contract
    const raw = await request<{ port?: number; token_version?: number }>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/preview-ports`,
      headers: { "X-API-Key": this._config.apiKey },
      body: { port },
    })
    if (raw.port === undefined || raw.token_version === undefined) {
      throw new SandboxError("Invalid publish-preview-port response")
    }
    return { port: raw.port, tokenVersion: raw.token_version }
  }

  /** Unpublish a port and revoke every outstanding token for it. */
  async unpublishPreviewPort(port: number): Promise<void> {
    this.getPreviewUrl(port)
    await requestVoid({
      method: "DELETE",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/preview-ports/${port}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
  }

  /**
   * Mint a header/query credential for an already-published port.
   * Omitting `expiresInSeconds` intentionally creates a long-running machine
   * credential that remains valid until this port is rotated or unpublished.
   */
  async getPreviewToken(
    port: number,
    options: PreviewTokenOptions = {},
  ): Promise<PreviewToken> {
    this.getPreviewUrl(port)
    const raw = await request<{
      token?: string
      port?: number
      header?: string
      query_param?: string
      token_version?: number
      preview_access?: string
      expires_at?: string
    }>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/preview-ports/${port}/token`,
      headers: { "X-API-Key": this._config.apiKey },
      body:
        options.expiresInSeconds === undefined
          ? {}
          : { expires_in_seconds: options.expiresInSeconds },
    })
    if (
      !raw.token ||
      raw.port === undefined ||
      !raw.header ||
      !raw.query_param ||
      raw.token_version === undefined
    ) {
      throw new SandboxError("Invalid preview-token response")
    }
    return {
      token: raw.token,
      port: raw.port,
      header: raw.header,
      queryParam: raw.query_param,
      tokenVersion: raw.token_version,
      previewAccess: (raw.preview_access ??
        "legacy_public") as PreviewToken["previewAccess"],
      expiresAt: raw.expires_at ? new Date(raw.expires_at) : undefined,
    }
  }

  /**
   * Build a browser-ready private preview URL. The proxy exchanges its query
   * token for a secure host cookie and removes the token from the address bar.
   */
  async getSignedPreviewUrl(
    port: number,
    options: SignedPreviewUrlOptions = {},
  ): Promise<string> {
    const credential = await this.getPreviewToken(port, {
      expiresInSeconds: options.expiresInSeconds ?? 60,
    })
    const url = new URL(this.getPreviewUrl(port))
    url.searchParams.set(credential.queryParam, credential.token)
    return url.toString()
  }

  /** Rotate only this port's token generation and return a fresh token. */
  async rotatePreviewToken(port: number): Promise<PreviewToken> {
    this.getPreviewUrl(port)
    const raw = await request<{
      token?: string
      port?: number
      header?: string
      query_param?: string
      token_version?: number
      preview_access?: string
      expires_at?: string
    }>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/preview-ports/${port}/token/rotate`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    if (
      !raw.token ||
      raw.port === undefined ||
      !raw.header ||
      !raw.query_param ||
      raw.token_version === undefined
    ) {
      throw new SandboxError("Invalid rotate-preview-token response")
    }
    return {
      token: raw.token,
      port: raw.port,
      header: raw.header,
      queryParam: raw.query_param,
      tokenVersion: raw.token_version,
      previewAccess: (raw.preview_access ??
        "legacy_public") as PreviewToken["previewAccess"],
      expiresAt: raw.expires_at ? new Date(raw.expires_at) : undefined,
    }
  }

  /**
   * The sandbox's network log: every outbound connection it made, newest first.
   * `connection` rows are raw egress (host, bytes, allow/deny verdict); `request`
   * rows are credential-injected requests (method, path, status, secret used).
   *
   * Filter by time window (`since`/`before`) and `verdict`. Paginate by passing
   * the returned `nextCursor` as `before` while `hasMore` is true.
   */
  async getNetworkLog(
    options: NetworkLogOptions = {},
  ): Promise<NetworkLogPage> {
    const qs = new URLSearchParams()
    if (options.limit !== undefined) qs.set("limit", String(options.limit))
    if (options.before !== undefined) qs.set("before", options.before)
    if (options.since !== undefined) qs.set("since", options.since)
    if (options.verdict !== undefined) qs.set("verdict", options.verdict)
    const suffix = qs.toString() ? `?${qs.toString()}` : ""

    const raw = await request<ApiNetworkPage>({
      method: "GET",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/network${suffix}`,
      headers: { "X-API-Key": this._config.apiKey },
      signal: options.signal,
    })
    return toNetworkLogPage(raw)
  }

  /**
   * Bind a team secret to this sandbox under an environment variable. The
   * sandbox sees a stand-in token; the real credential is swapped in for
   * outbound requests to the secret's allowed hosts. Takes effect for processes
   * started after this call; a paused sandbox applies it on resume.
   *
   * The local `secrets` summary is a snapshot from when the sandbox was fetched
   * and is not updated here — call `Sandbox.get(id)` for the current set.
   */
  async attachSecret(envKey: string, secretName: string): Promise<void> {
    await requestVoid({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/secrets`,
      headers: { "X-API-Key": this._config.apiKey },
      body: { env_key: envKey, secret_name: secretName },
    })
  }

  /**
   * Remove a secret binding from this sandbox by its environment-variable key.
   * The stand-in token is revoked, so requests using it are refused — within
   * about a minute for a process already running. A paused sandbox applies the
   * change on resume.
   */
  async detachSecret(envKey: string): Promise<void> {
    await requestVoid({
      method: "DELETE",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/secrets/${encodeURIComponent(envKey)}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
  }
}
