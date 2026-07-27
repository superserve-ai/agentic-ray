/**
 * Full-duplex command sessions over the data-plane `/exec/connect` WebSocket.
 *
 * The wire is byte-exact: I/O rides binary frames tagged with a one-byte
 * channel (0 stdin, 1 stdout, 2 stderr); lifecycle and control ride text JSON
 * frames. `spawnCommand` opens the socket, sends the start frame, and returns
 * a `CommandSession` handle. Backs `sandbox.commands.spawn(...)`.
 */

import { SandboxError } from "./errors.js"
import type {
  CommandResult,
  CommandSession,
  CommandStdin,
  SpawnOptions,
} from "./types.js"

// Negotiated on upgrade alongside the `token.<value>` carrier subprotocol.
const EXEC_SUBPROTOCOL = "superserve.exec.v1"
const TOKEN_PREFIX = "token."

const CH_STDIN = 0x00
const CH_STDOUT = 0x01
const CH_STDERR = 0x02

// Cap on a single stdin frame; larger writes are split transparently. Must
// stay under the smallest per-message limit enforced by any deployed server
// (64 KiB historically; newer servers allow more) — raising it can break
// sessions against servers that still enforce the older limit.
// Exported for tests.
export const STDIN_CHUNK_BYTES = 32 * 1024

const encoder = new TextEncoder()

/** @internal Connection inputs, satisfied by Commands' own deps. */
export interface SpawnDeps {
  sandboxId: string
  sandboxHost: string
  getAccessToken: () => string
  refreshActivate: () => Promise<string>
}

interface Lifecycle {
  exit_code?: number
  finished?: boolean
  error?: string
  code?: string
}

/** Open an exec session: dial, send the start frame, return the handle. */
export async function spawnCommand(
  deps: SpawnDeps,
  command: string,
  options: SpawnOptions,
): Promise<CommandSession> {
  if (typeof WebSocket === "undefined") {
    throw new SandboxError(
      "commands.spawn requires a global WebSocket (Node 22+, a browser, or a polyfill).",
    )
  }
  // Always the per-sandbox subdomain, not the shared-host routing that run/
  // files use: a browser can't set the sandbox-id header on a WS upgrade, and
  // each session is its own long-lived socket, so there's no pool to share.
  const url = `wss://boxd-${deps.sandboxId}.${deps.sandboxHost}/exec/connect`
  const ws = await dialWithResume(deps, url)
  ws.send(JSON.stringify(buildStart(command, options)))
  return new Session(ws, options)
}

function buildStart(command: string, o: SpawnOptions): Record<string, unknown> {
  const start: Record<string, unknown> = { command }
  if (o.cwd !== undefined) start.working_dir = o.cwd
  if (o.env !== undefined) start.env = o.env
  if (o.timeoutMs !== undefined) start.timeout_s = Math.ceil(o.timeoutMs / 1000)
  return start
}

// A failed dial usually means a stale token or a paused sandbox, both fixed by
// activating (which resumes and rotates the token). Only retry on a dial error
// (the SandboxError dial() throws), so a programming bug surfaces immediately.
async function dialWithResume(
  deps: SpawnDeps,
  url: string,
): Promise<WebSocket> {
  try {
    return await dial(url, deps.getAccessToken())
  } catch (err) {
    if (!(err instanceof SandboxError)) throw err
    const fresh = await deps.refreshActivate()
    return await dial(url, fresh)
  }
}

function dial(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, [EXEC_SUBPROTOCOL, TOKEN_PREFIX + token])
    ws.binaryType = "arraybuffer"
    const cleanup = () => {
      ws.removeEventListener("open", onOpen)
      ws.removeEventListener("error", onError)
      ws.removeEventListener("close", onClose)
    }
    const onOpen = () => {
      cleanup()
      resolve(ws)
    }
    const onError = () => {
      cleanup()
      reject(new SandboxError("exec/connect: connection failed"))
    }
    const onClose = (ev: CloseEvent) => {
      cleanup()
      reject(
        new SandboxError(`exec/connect: closed before open (code ${ev.code})`),
      )
    }
    ws.addEventListener("open", onOpen)
    ws.addEventListener("error", onError)
    ws.addEventListener("close", onClose)
  })
}

class Session implements CommandSession {
  readonly stdin: CommandStdin
  private readonly _ws: WebSocket
  // Streaming decoders carry partial multi-byte runes across frame boundaries.
  private readonly _outDecoder = new TextDecoder()
  private readonly _errDecoder = new TextDecoder()
  private _stdout = ""
  private _stderr = ""
  private _settled = false
  private readonly _result: Promise<CommandResult>
  private _resolve!: (r: CommandResult) => void
  private _reject!: (e: unknown) => void

  constructor(ws: WebSocket, options: SpawnOptions) {
    this._ws = ws
    this._result = new Promise<CommandResult>((res, rej) => {
      this._resolve = res
      this._reject = rej
    })
    // Don't let an unawaited wait() surface as an unhandled rejection.
    this._result.catch(() => {})

    this.stdin = {
      // No-op once the socket is closing/closed, instead of throwing.
      write: (data) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const bytes = typeof data === "string" ? encoder.encode(data) : data
        for (let off = 0; off < bytes.length; off += STDIN_CHUNK_BYTES) {
          const chunk = bytes.subarray(off, off + STDIN_CHUNK_BYTES)
          const frame = new Uint8Array(chunk.length + 1)
          frame[0] = CH_STDIN
          frame.set(chunk, 1)
          ws.send(frame)
        }
      },
      close: () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "stdin_close" }))
        }
      },
    }

    ws.addEventListener("message", (ev) => this._onMessage(ev, options))
    ws.addEventListener("close", (ev) => this._onClose(ev))

    const signal = options.signal
    if (signal) {
      if (signal.aborted) this._abort()
      else {
        const onAbort = () => this._abort()
        signal.addEventListener("abort", onAbort, { once: true })
        // Drop the listener once settled so a reused signal doesn't retain
        // every finished session.
        void this._result.finally(() =>
          signal.removeEventListener("abort", onAbort),
        )
      }
    }
  }

  kill(signal = "SIGTERM"): void {
    if (this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: "signal", name: signal }))
    }
  }

  wait(): Promise<CommandResult> {
    return this._result
  }

  // Kill the process, close the socket, and resolve once the session settles
  // (swallowing the connection-closed rejection — cleanup isn't a failure).
  close(): Promise<void> {
    this._abort()
    return this._result.then(
      () => undefined,
      () => undefined,
    )
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private _abort(): void {
    this.kill()
    if (this._ws.readyState <= WebSocket.OPEN) this._ws.close()
  }

  private _onMessage(ev: MessageEvent, options: SpawnOptions): void {
    if (typeof ev.data === "string") {
      this._onLifecycle(ev.data)
      return
    }
    const view = new Uint8Array(ev.data as ArrayBuffer)
    if (view.length === 0) return
    const payload = view.subarray(1)
    if (view[0] === CH_STDOUT) {
      const text = this._outDecoder.decode(payload, { stream: true })
      this._stdout += text
      if (text) options.onStdout?.(text)
    } else if (view[0] === CH_STDERR) {
      const text = this._errDecoder.decode(payload, { stream: true })
      this._stderr += text
      if (text) options.onStderr?.(text)
    }
  }

  private _onLifecycle(raw: string): void {
    let ev: Lifecycle
    try {
      ev = JSON.parse(raw)
    } catch {
      return
    }
    if (ev.error) this._stderr += ev.error
    if (ev.finished) this._finish(ev.exit_code ?? 0)
  }

  private _onClose(ev: CloseEvent): void {
    // Surface the server's close code/reason — an unexplained drop is the
    // hardest failure to debug. 1009 means a single frame exceeded the
    // server's message size limit.
    const detail =
      ev.code === 1009
        ? "a message exceeded the server's size limit — usually an oversized command string; keep the command small and send bulk data via stdin or the files API"
        : ev.reason || `close code ${ev.code}`
    this._fail(
      new SandboxError(
        `exec/connect: connection closed before the command finished (${detail})`,
      ),
    )
  }

  private _finish(exitCode: number): void {
    if (this._settled) return
    this._settled = true
    this._flush()
    this._resolve({ stdout: this._stdout, stderr: this._stderr, exitCode })
  }

  private _fail(err: unknown): void {
    if (this._settled) return
    this._settled = true
    this._flush()
    this._reject(err)
  }

  // Emit any bytes still buffered in the streaming decoders.
  private _flush(): void {
    this._stdout += this._outDecoder.decode()
    this._stderr += this._errDecoder.decode()
  }
}
