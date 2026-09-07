#!/usr/bin/env node
// --spawn hook for `agent worker controller`. Runs once per claimed request
// (or once per missing warm worker) with CURSOR_* set by the controller.
// Creates a Superserve sandbox and starts a Cursor pool worker inside it.
import "./env.mjs"
import { Sandbox } from "@superserve/sdk"

import {
  META_MANAGED,
  META_LAUNCHING,
  META_POOL,
  META_REPO,
  META_REQUEST_ID,
  META_WORKER_ID,
  config,
  findSandboxForWorker,
  launchWorker,
  releaseClaim,
  tagSandbox,
  workerEnv,
  workerState,
} from "./worker.mjs"

for (const key of [
  "SUPERSERVE_API_KEY",
  "CURSOR_API_KEY",
  "CURSOR_AGENT_WORKER_ID",
  "CURSOR_POOL",
]) {
  if (!process.env[key]) {
    console.error(`spawn: ${key} is not set`)
    process.exit(2)
  }
}

const workerId = process.env.CURSOR_AGENT_WORKER_ID
const pool = process.env.CURSOR_POOL
const requestId = process.env.CURSOR_REQUEST_ID
const workerName = process.env.CURSOR_WORKER_NAME
const repo =
  process.env.CURSOR_REPO_OWNER && process.env.CURSOR_REPO_NAME
    ? `${process.env.CURSOR_REPO_OWNER}/${process.env.CURSOR_REPO_NAME}`
    : undefined

function sandboxName() {
  const short = workerId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12)
  return `cursor-${short || "worker"}`
}

async function createSandbox() {
  const metadata = {
    [META_MANAGED]: "true",
    [META_WORKER_ID]: workerId,
    [META_POOL]: pool,
  }
  if (requestId) metadata[META_REQUEST_ID] = requestId
  if (repo) metadata[META_REPO] = repo

  const options = {
    name: sandboxName(),
    fromTemplate: config.templateName,
    metadata,
    autoDeleteSeconds: config.autoDeleteSeconds,
  }
  if (config.allowOut.length > 0) {
    options.network = { allowOut: config.allowOut, denyOut: ["0.0.0.0/0"] }
  }
  return Sandbox.create(options)
}

// Hand the request back and drop a sandbox we created, so a failed spawn
// never strands a claim or leaves an idle sandbox running.
async function abandon(sandbox, created) {
  if (requestId) {
    try {
      await releaseClaim(requestId)
      console.error(`spawn: released claim request=${requestId}`)
    } catch (e) {
      console.error(
        `spawn: could not release claim request=${requestId}: ${e.message}`,
      )
    }
  }
  if (created && sandbox) {
    try {
      await sandbox.kill()
    } catch (e) {
      console.error(
        `spawn: could not delete sandbox=${sandbox.id}: ${e.message}`,
      )
    }
  }
}

async function main() {
  let sandbox
  let created = false

  try {
    // A paused sandbox tagged with this worker id is a hibernated workspace
    // (see the monitor). Resume it instead of starting from scratch.
    const existing = await findSandboxForWorker(workerId)
    if (existing) {
      console.log(
        `spawn: reusing sandbox=${existing.id} status=${existing.status} worker=${workerId}`,
      )
      // Tell the monitor a relaunch is in progress before anything resumes the
      // sandbox: connect() auto-resumes, and the previous worker's exit file
      // is visible the moment it does.
      await Sandbox.updateById(existing.id, {
        metadata: {
          ...existing.metadata,
          [META_LAUNCHING]: String(Date.now()),
        },
      })
      sandbox = await Sandbox.connect(existing.id)
      if (sandbox.status === "paused") await sandbox.resume()
      const state = await workerState(sandbox)
      if (state.state === "running") {
        console.log(
          `spawn: worker already running pid=${state.pid} sandbox=${sandbox.id}`,
        )
        return 0
      }
    } else {
      sandbox = await createSandbox()
      created = true
      console.log(
        `spawn: created sandbox=${sandbox.id} template=${config.templateName} worker=${workerId}`,
      )
    }

    const result = await launchWorker(sandbox, {
      pool,
      env: workerEnv({ workerId, workerName }),
    })
    if (!created) await tagSandbox(sandbox, { [META_LAUNCHING]: null })
    if (!result.ok) {
      console.error(
        `spawn: worker failed to start sandbox=${sandbox.id} state=${result.state.state} ` +
          `exit=${result.state.exit_code ?? "-"}\n${result.log.slice(-2000)}`,
      )
      await abandon(sandbox, created)
      return 1
    }

    console.log(
      `spawn: worker started pid=${result.pid} sandbox=${sandbox.id} pool=${pool} worker=${workerId}` +
        (requestId ? ` request=${requestId}` : ""),
    )
    return 0
  } catch (e) {
    console.error(`spawn: ${e.message}`)
    await abandon(sandbox, created)
    return 1
  }
}

process.exit(await main())
