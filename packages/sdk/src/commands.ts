/**
 * `sandbox.commands` - run shell commands inside a sandbox.
 *
 * Hits the per-sandbox data plane with the access token. A paused sandbox
 * (401 stale token, or 503 because the VM isn't running) is transparently
 * resumed via `POST /activate` and the call is retried once — see
 * `tokenRetry.ts`.
 *
 * Accessed as `sandbox.commands.run(...)`.
 */

import { spawnCommand } from "./commandSession.js"
import { dataPlaneTarget } from "./config.js"
import { SandboxError } from "./errors.js"
import { request, streamSSE } from "./http.js"
import { withTokenRetry } from "./tokenRetry.js"
import type {
  ApiExecResult,
  ApiExecStreamEvent,
  CommandOptions,
  CommandResult,
  CommandSession,
  SpawnOptions,
} from "./types.js"

/** @internal */
export interface CommandsDeps {
  sandboxId: string
  sandboxHost: string
  getAccessToken: () => string
  refreshActivate: () => Promise<string>
}

/**
 * Max bytes read from a non-streaming `/exec` response before the SDK aborts
 * the read and throws `ValidationError`.
 *
 * The data plane is untrusted: `boxd`'s sync exec handler buffers the command's
 * full stdout/stderr in the VM and returns it in one JSON body, and neither the
 * data-plane proxy nor `fetch` caps that body — so a command can stream back as
 * much output as the sandbox has RAM. Buffering it unbounded into memory is a
 * DoS vector for any shared host (e.g. the hosted MCP server). Callers that
 * genuinely need large output should stream via `onStdout`/`onStderr` instead.
 */
export const MAX_EXEC_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MiB

export class Commands {
  private readonly _dataPlaneBaseUrl: string
  private readonly _routingHeaders: Record<string, string>

  /** @internal */
  constructor(private readonly _deps: CommandsDeps) {
    const target = dataPlaneTarget(_deps.sandboxId, _deps.sandboxHost)
    this._dataPlaneBaseUrl = target.url
    this._routingHeaders = target.headers
  }

  /**
   * Execute a command inside the sandbox.
   *
   * If `onStdout` or `onStderr` callbacks are provided, the command is
   * streamed via SSE. Otherwise, it runs synchronously (waits for completion).
   *
   * Paused sandboxes are transparently resumed before execution.
   *
   * @example
   * ```typescript
   * // Synchronous
   * const result = await sandbox.commands.run("echo hello")
   * console.log(result.stdout) // "hello\n"
   *
   * // Streaming
   * const result = await sandbox.commands.run("npm start", {
   *   onStdout: (data) => process.stdout.write(data),
   *   onStderr: (data) => process.stderr.write(data),
   *   timeoutMs: 120_000,
   * })
   * ```
   */
  async run(
    command: string,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    const { cwd, env, timeoutMs, onStdout, onStderr } = options
    const isStreaming = onStdout !== undefined || onStderr !== undefined

    const body: Record<string, unknown> = { command }
    if (cwd !== undefined) body.working_dir = cwd
    if (env !== undefined) body.env = env
    // API expects seconds; convert from ms
    if (timeoutMs !== undefined) body.timeout_s = Math.ceil(timeoutMs / 1000)

    if (isStreaming) {
      return this._runStreaming(body, options)
    }
    return this._runSync(body, options)
  }

  /**
   * Spawn a command and return a live, full-duplex session.
   *
   * Unlike `run` (one-shot), `spawn` hands back a handle while the process is
   * still running: stream output via `onStdout`/`onStderr`, write to its
   * `stdin`, `kill` it, and `await session.wait()` for the exit result.
   *
   * Release the session when you're done (use `await using`, or call `wait()`
   * or `close()`) so the socket and its reader are cleaned up.
   *
   * A paused sandbox is resumed transparently before the session opens.
   *
   * @example
   * ```typescript
   * const session = await sandbox.commands.spawn("python -i", {
   *   onStdout: (data) => process.stdout.write(data),
   * })
   * session.stdin.write("print(2 + 2)\n")
   * session.stdin.close()
   * const { exitCode } = await session.wait()
   * ```
   */
  spawn(command: string, options: SpawnOptions = {}): Promise<CommandSession> {
    return spawnCommand(this._deps, command, options)
  }

  private async _runSync(
    body: Record<string, unknown>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    const send = (token: string) =>
      request<ApiExecResult>({
        method: "POST",
        url: `${this._dataPlaneBaseUrl}/exec`,
        headers: { ...this._routingHeaders, "X-Access-Token": token },
        body,
        // Add a 5s buffer so the server-side command timeout fires first
        // and returns its proper response before the client aborts.
        timeoutMs:
          options.timeoutMs !== undefined
            ? options.timeoutMs + 5_000
            : undefined,
        signal: options.signal,
        // The data plane is untrusted — bound the buffered response so a
        // command's runaway stdout/stderr can't exhaust the caller's memory.
        maxBytes: options.maxOutputBytes ?? MAX_EXEC_RESPONSE_BYTES,
      })

    const raw = await withTokenRetry(this._deps, send)
    return {
      stdout: raw.stdout ?? "",
      stderr: raw.stderr ?? "",
      exitCode: raw.exit_code ?? 0,
      truncated: raw.truncated ?? false,
    }
  }

  private async _runStreaming(
    body: Record<string, unknown>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    const send = async (token: string) =>
      this._consumeStream(
        `${this._dataPlaneBaseUrl}/exec/stream`,
        { ...this._routingHeaders, "X-Access-Token": token },
        body,
        options,
      )
    // Safe for streaming: the resumable status (401/503) is returned before any
    // SSE data is written, so a retry can't double-emit callbacks.
    return withTokenRetry(this._deps, send)
  }

  private async _consumeStream(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    let stdout = ""
    let stderr = ""
    let exitCode = 0
    let error: string | undefined
    let sawFinished = false

    await streamSSE({
      url,
      headers,
      body,
      timeoutMs:
        options.timeoutMs !== undefined ? options.timeoutMs + 5_000 : undefined,
      signal: options.signal,
      onEvent: (event: ApiExecStreamEvent) => {
        if (event.stdout) {
          stdout += event.stdout
          options.onStdout?.(event.stdout)
        }
        if (event.stderr) {
          stderr += event.stderr
          options.onStderr?.(event.stderr)
        }
        if (event.finished) {
          sawFinished = true
          exitCode = event.exit_code ?? 0
          error = event.error
        }
      },
    })

    if (!sawFinished) {
      throw new SandboxError(
        "Command stream ended without a finished event (possible network disconnect)",
      )
    }

    if (error) {
      stderr += error
    }

    return { stdout, stderr, exitCode, truncated: false }
  }
}
