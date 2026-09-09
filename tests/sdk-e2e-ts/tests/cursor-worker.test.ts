import { Sandbox } from "@superserve/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  ensureTemplate,
  TEMPLATE_NAME,
} from "../../../guides/managed-agents/cursor-cloud-agents/typescript/template.mjs"
import {
  findSandboxForWorker,
  launchWorker,
  META_MANAGED,
  META_POOL,
  META_WORKER_ID,
  readLog,
  stopWorker,
  workerEnv,
  workerState,
} from "../../../guides/managed-agents/cursor-cloud-agents/typescript/worker.mjs"
import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

// Exercises the Cursor Self-Hosted Machines guide against a live environment
// without a Cursor account: the template, the detached worker supervisor, the
// real worker binary's failure path, and the hibernate/resume lookup. The live
// Cursor loop (a service-account key, a real pool) is out of scope here.
//
// The guide's helpers read connection settings from the environment, so the
// suite's options are exported before they load.
const opts = hasCredentials()
  ? connectionOptions()
  : { apiKey: "", baseUrl: "" }
if (hasCredentials()) {
  process.env.SUPERSERVE_API_KEY = opts.apiKey
  if (opts.baseUrl) process.env.SUPERSERVE_BASE_URL = opts.baseUrl
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const POOL = "sdk-e2e"

describe.skipIf(!hasCredentials())("cursor worker guide", () => {
  const workerId = `sdk-e2e-${RUN_ID}`
  let sandbox: Sandbox

  // First run on a team builds the template (about a minute); later runs reuse it.
  beforeAll(async () => {
    await ensureTemplate({ log: () => {} })
    sandbox = await Sandbox.create({
      name: `sdk-e2e-cursor-${RUN_ID}`,
      fromTemplate: TEMPLATE_NAME,
      metadata: {
        [META_MANAGED]: "true",
        [META_WORKER_ID]: workerId,
        [META_POOL]: POOL,
      },
      ...opts,
    })
  }, 300_000)

  afterAll(async () => {
    if (!sandbox?.id) return
    try {
      await sandbox.kill()
    } catch (err) {
      console.error(`Cleanup failed for sandbox ${sandbox.id}:`, err)
    }
  })

  it("boots with the Cursor CLI on PATH", async () => {
    const r = await sandbox.commands.run(
      "agent --version && git --version && test -d /workspace",
    )
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/\d{4}\.\d{2}\.\d{2}/)
  })

  it("launches a detached process that outlives the exec call", async () => {
    const res = await launchWorker(sandbox, {
      pool: POOL,
      env: {},
      command: "sleep 300",
    })
    expect(res.ok).toBe(true)
    await sleep(3000)
    const state = await workerState(sandbox)
    expect(state.state).toBe("running")
    expect(state.pid).toBe(res.ok ? res.pid : null)
  })

  it("stops the process group and clears its state files", async () => {
    const before = await workerState(sandbox)
    await stopWorker(sandbox)
    const after = await workerState(sandbox)
    expect(after.state).toBe("no_pidfile")
    const alive = await sandbox.commands.run(
      `kill -0 ${before.pid} 2>/dev/null && echo ALIVE || echo GONE`,
    )
    expect(alive.stdout.trim()).toBe("GONE")
  })

  it("captures the exit code of a process that ends", async () => {
    const res = await launchWorker(sandbox, {
      pool: POOL,
      env: {},
      command: "sh -c 'exit 7'",
    })
    expect(res.ok).toBe(false)
    expect(res.state).toMatchObject({ state: "exited", exit_code: 7 })
  })

  it("runs the real worker binary and surfaces its failure", async () => {
    // A bogus key proves the binary starts, reads its env, and reaches Cursor
    // far enough to be rejected. The log tail is what the spawn hook prints.
    process.env.CURSOR_API_KEY = "not-a-real-cursor-key"
    const res = await launchWorker(sandbox, {
      pool: POOL,
      env: workerEnv({ workerId, workerName: "sdk-e2e" }),
    })
    expect(res.ok).toBe(false)
    expect(res.state.state).toBe("exited")
    expect(await readLog(sandbox)).toMatch(/API key/i)
  })

  it("is found by worker id after a pause, with its workspace intact", async () => {
    await sandbox.commands.run("echo keepme > /workspace/marker.txt")
    await sandbox.pause()

    const found = await findSandboxForWorker(workerId)
    expect(found?.id).toBe(sandbox.id)
    expect(found?.status).toBe("paused")

    const resumed = await Sandbox.connect(found!.id, opts)
    if (resumed.status === "paused") await resumed.resume()
    const r = await resumed.commands.run("cat /workspace/marker.txt")
    expect(r.stdout.trim()).toBe("keepme")
  })
})
