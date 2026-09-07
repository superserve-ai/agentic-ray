#!/usr/bin/env node
// Long-running janitor for worker sandboxes. When a worker exits (idle
// release, crash, or manual stop) the sandbox is deleted, or paused when
// CURSOR_WORKER_HIBERNATE=true. In hibernate mode it also watches the pool's
// pending requests and resumes a paused sandbox when Cursor asks for its
// worker again (a claimed-but-offline entry with that worker id).
import "./env.mjs"
import { Sandbox } from "@superserve/sdk"

import {
  META_MANAGED,
  META_POOL,
  META_WORKER_ID,
  config,
  launchWorker,
  listPendingRequests,
  workerEnv,
  workerState,
} from "./worker.mjs"

if (!process.env.SUPERSERVE_API_KEY) {
  console.error("monitor: SUPERSERVE_API_KEY is not set")
  process.exit(2)
}

const TERMINAL_STATES = new Set(["exited", "dead", "no_pidfile"])
const ONCE = process.argv.includes("--once")
const POLL_MS = Number(process.env.MONITOR_POLL_SECONDS || 15) * 1000
const GRACE_MS = Number(process.env.MONITOR_GRACE_SECONDS || 120) * 1000
const WAKE_ENABLED = config.hibernate && Boolean(process.env.CURSOR_API_KEY)
const pool = process.env.CURSOR_POOL

let shuttingDown = false
const waking = new Set()

async function recycle(info) {
  const sandbox = await Sandbox.connect(info.id)
  const state = await workerState(sandbox)
  // Only act on confirmed terminal states. An inconclusive probe (transient
  // exec error, malformed output) is retried on the next sweep.
  if (!TERMINAL_STATES.has(state.state)) {
    if (state.state !== "running")
      console.warn(
        `monitor: sandbox=${info.id} probe inconclusive (${state.state}), retrying next sweep`,
      )
    return
  }

  const worker = info.metadata[META_WORKER_ID]
  const detail = `state=${state.state} exit=${state.exit_code ?? "-"} worker=${worker}`
  if (config.hibernate) {
    console.log(`monitor: pausing sandbox=${info.id} ${detail}`)
    await sandbox.pause()
  } else {
    console.log(`monitor: deleting sandbox=${info.id} ${detail}`)
    await sandbox.kill()
  }
}

async function sweep() {
  // Scope to this monitor's pool so parallel pool deployments never touch
  // each other's sandboxes.
  const filter = { [META_MANAGED]: "true" }
  if (pool) filter[META_POOL] = pool
  const sandboxes = await Sandbox.list({ metadata: filter })
  const now = Date.now()
  for (const info of sandboxes) {
    if (info.status !== "active") continue
    // Give a freshly spawned sandbox time to bring its worker up.
    if (now - info.createdAt.getTime() < GRACE_MS) continue
    if (waking.has(info.id)) continue
    try {
      await recycle(info)
    } catch (e) {
      console.warn(`monitor: sandbox=${info.id} error: ${e.message}`)
    }
  }
  return sandboxes
}

async function wakeOne(info, request) {
  const workerId = request.claimedWorkerId
  waking.add(info.id)
  try {
    console.log(
      `monitor: waking sandbox=${info.id} worker=${workerId} request=${request.id} ` +
        `window=${Math.round((request.wakeTimeoutMs ?? 0) / 1000)}s`,
    )
    const sandbox = await Sandbox.connect(info.id)
    if (sandbox.status === "paused") await sandbox.resume()
    const result = await launchWorker(sandbox, {
      pool: info.metadata[META_POOL] || pool,
      env: workerEnv({ workerId }),
    })
    if (result.ok) {
      console.log(
        `monitor: worker resumed pid=${result.pid} sandbox=${info.id} worker=${workerId}`,
      )
    } else {
      console.error(
        `monitor: worker failed to resume sandbox=${info.id} state=${result.state.state}\n` +
          result.log.slice(-2000),
      )
    }
  } finally {
    waking.delete(info.id)
  }
}

async function wake(sandboxes) {
  const paused = new Map()
  for (const s of sandboxes) {
    if (s.status === "paused" && s.metadata[META_WORKER_ID])
      paused.set(s.metadata[META_WORKER_ID], s)
  }
  if (paused.size === 0) return

  const requests = await listPendingRequests(pool)
  for (const request of requests) {
    const info = request.claimedWorkerId
      ? paused.get(request.claimedWorkerId)
      : undefined
    if (!info || waking.has(info.id)) continue
    try {
      await wakeOne(info, request)
    } catch (e) {
      console.error(`monitor: wake sandbox=${info.id} error: ${e.message}`)
    }
  }
}

process.once("SIGTERM", () => {
  shuttingDown = true
})
process.once("SIGINT", () => {
  shuttingDown = true
})

console.log(
  `monitor: watching template=${config.templateName} hibernate=${config.hibernate} ` +
    `wake=${WAKE_ENABLED}${pool ? ` pool=${pool}` : ""} every ${POLL_MS / 1000}s`,
)

// eslint-disable-next-line no-unmodified-loop-condition -- signal handlers flip shuttingDown.
while (!shuttingDown) {
  try {
    const sandboxes = await sweep()
    if (WAKE_ENABLED) await wake(sandboxes)
  } catch (e) {
    console.warn(`monitor: ${e.message}`)
  }
  if (ONCE) break
  await new Promise((r) => setTimeout(r, POLL_MS))
}
console.log("monitor: stopped")
