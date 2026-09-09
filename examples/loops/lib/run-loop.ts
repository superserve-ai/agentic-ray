import {
  Sandbox,
  SandboxError,
  ServerError,
  TimeoutError,
} from "@superserve/sdk"

/**
 * Everything a loop needs to bootstrap ONCE and then tick warm inside a single
 * persistent sandbox. This is the whole point of running loops on Superserve:
 * the expensive `setup` (clone + install + auth) happens only on first create;
 * every later tick resumes the warm box and runs `iterate` alone.
 */
export interface LoopSpec {
  /** Stable identity; used for metadata-based discovery of this loop's box. */
  name: string
  /** Tag the box so we can rediscover it next tick (e.g. `{ loop, repo }`). */
  metadata: Record<string, string>
  /** Template to boot from on first create. Defaults to `superserve/base`. */
  template?: string
  /** Team-stored secrets bound to env vars: `{ ENV_VAR: secretName }`. The
   *  real value never enters the box — a proxy token is swapped in at egress. */
  secrets?: Record<string, string>
  /** Non-sensitive env vars injected into the box. */
  envVars?: Record<string, string>
  /** Egress allow/deny lists. Omit for the platform default (open egress). */
  network?: { allowOut?: string[]; denyOut?: string[] }
  /** Files written INTO the box on first create (absolute path -> contents). */
  uploads?: Record<string, string>
  /** Runs ONCE, only when the box is first created (after uploads). */
  setup: string
  /** Runs EVERY tick, inside the warm box. */
  iterate: string
  /** Pause the box after the tick to stop compute billing. Defaults to true. */
  pauseWhenDone?: boolean
}

export interface RunResult {
  sandboxId: string
  /** True when this tick created + bootstrapped a fresh box (the cold start). */
  bootstrapped: boolean
  exitCode: number
  stdout: string
}

/** The live-box surface the spine drives — a subset of `Sandbox`, so an
 *  in-memory fake can stand in for it in tests. */
export interface SandboxHandle {
  readonly id: string
  files: { write(path: string, content: string): Promise<void> }
  commands: {
    run(
      command: string,
      options?: {
        cwd?: string
        env?: Record<string, string>
        timeoutMs?: number
        onStdout?: (data: string) => void
        onStderr?: (data: string) => void
      },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>
  }
  pause(): Promise<void>
  /** Destroy the box. Used to tear down a half-built box when `setup` fails, so
   *  the next tick re-bootstraps from scratch instead of resuming it broken. */
  kill(): Promise<void>
}

/** The sandbox operations the spine needs. Injectable so tests can fake them. */
export interface SandboxOps {
  list(metadata: Record<string, string>): Promise<Array<{ id: string }>>
  connect(id: string): Promise<SandboxHandle>
  create(options: {
    name: string
    metadata: Record<string, string>
    fromTemplate?: string
    secrets?: Record<string, string>
    envVars?: Record<string, string>
    network?: { allowOut?: string[]; denyOut?: string[] }
  }): Promise<SandboxHandle>
}

/** Default ops backed by the real `@superserve/sdk`. */
export const sdkOps: SandboxOps = {
  list: (metadata) => Sandbox.list({ metadata }),
  connect: (id) => Sandbox.connect(id),
  create: (options) => Sandbox.create(options),
}

/** A loop tick can run a full agent harness; give it generous headroom. */
const ITERATE_TIMEOUT_MS = 20 * 60_000
const CONNECT_MAX_ATTEMPTS = 3
const CONNECT_BASE_BACKOFF_MS = 1_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (!(err instanceof Error)) return false
  if (err.name === "FetchError" || err.name === "NetworkError") return true
  return "cause" in err && isNetworkError(err.cause)
}

function isRetryableConnectError(err: unknown): boolean {
  if (err instanceof ServerError || err instanceof TimeoutError) return true
  if (
    err instanceof SandboxError &&
    err.statusCode !== undefined &&
    err.statusCode >= 500
  ) {
    return true
  }
  return isNetworkError(err)
}

async function connectWithRetry(
  id: string,
  ops: SandboxOps,
  log: (line: string) => void,
): Promise<SandboxHandle> {
  for (let attempt = 1; attempt <= CONNECT_MAX_ATTEMPTS; attempt++) {
    try {
      return await ops.connect(id)
    } catch (err) {
      if (!isRetryableConnectError(err) || attempt === CONNECT_MAX_ATTEMPTS) {
        throw err
      }

      const delayMs = CONNECT_BASE_BACKOFF_MS * 2 ** (attempt - 1)
      log(
        `[runLoop] connect to ${id} failed (attempt ${attempt}/${CONNECT_MAX_ATTEMPTS}); ` +
          `retrying in ${delayMs}ms: ${String(err)}\n`,
      )
      await sleep(delayMs)
    }
  }

  throw new Error(`failed to connect to ${id}`)
}

/**
 * The reusable loop spine.
 *
 * Finds this loop's box by `metadata`. On the FIRST run there is no box, so it
 * creates one, uploads the work scripts, and runs `setup` exactly once. On every
 * later run the box already exists, so it resumes the warm box (repo + deps + the
 * agent harness all still there) and runs `iterate` only. The box is paused after.
 */
export async function runLoop(
  spec: LoopSpec,
  ops: SandboxOps = sdkOps,
  log: (line: string) => void = (line) => {
    process.stdout.write(line)
  },
): Promise<RunResult> {
  const [existing] = await ops.list(spec.metadata)
  const bootstrapped = existing === undefined
  const box = bootstrapped
    ? await ops.create({
        name: spec.name,
        metadata: spec.metadata,
        fromTemplate: spec.template,
        secrets: spec.secrets,
        envVars: spec.envVars,
        network: spec.network,
      })
    : await connectWithRetry(existing.id, ops, log)

  let destroyed = false
  try {
    if (bootstrapped) {
      for (const [path, contents] of Object.entries(spec.uploads ?? {})) {
        await box.files.write(path, contents)
      }
      // The expensive step — runs once, every warm tick skips it.
      const setup = await box.commands.run(spec.setup, {
        onStdout: log,
        onStderr: log,
      })
      // A failed bootstrap must not be ignored: the box already exists, so the
      // next tick would rediscover it, skip setup, and run `iterate` forever
      // against a broken, half-built box. Tear it down so the loop self-heals.
      if (setup.exitCode !== 0) {
        destroyed = true
        await box.kill().catch((err: unknown) => {
          log(
            `[runLoop] warning: failed to destroy ${box.id}: ${String(err)}\n`,
          )
        })
        throw new Error(
          `loop "${spec.name}" setup failed (exit ${setup.exitCode}); ` +
            `destroyed sandbox ${box.id} so the next tick re-bootstraps`,
        )
      }
    }

    // Re-inject raw envVars on EVERY tick, not just at create. The GitHub Actions
    // `github.token` is minted per-run and dies when that run's job ends; a warm
    // resume would otherwise keep running against the first tick's now-expired
    // token and 401 on every `gh`/git call. Secret BINDINGS (spec.secrets) need no
    // such refresh: they attach by NAME at create and the platform swaps the
    // secret's current value in at egress, so a rotated secret is picked up
    // automatically. Only raw env values go stale.
    const result = await box.commands.run(spec.iterate, {
      env: spec.envVars,
      timeoutMs: ITERATE_TIMEOUT_MS,
      onStdout: log,
      onStderr: log,
    })

    return {
      sandboxId: box.id,
      bootstrapped,
      exitCode: result.exitCode,
      stdout: result.stdout,
    }
  } finally {
    // Pause is best-effort: a dead/unreachable box must not throw here and mask
    // the real error escaping the try block. Skip it entirely if we tore down.
    if (!destroyed && (spec.pauseWhenDone ?? true)) {
      await box.pause().catch((err: unknown) => {
        log(`[runLoop] warning: failed to pause ${box.id}: ${String(err)}\n`)
      })
    }
  }
}
