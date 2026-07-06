import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"
import { Sandbox } from "@superserve/sdk"
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs"

const ENVIRONMENT_KEY = process.env.ANTHROPIC_ENVIRONMENT_KEY
const ENVIRONMENT_ID = process.env.ANTHROPIC_ENVIRONMENT_ID
const TEMPLATE_NAME = "claude-dev-environment"
const IDLE_TIMEOUT = 300_000
const JANITOR_INTERVAL = 60_000

// Sandboxes use a deny-by-default egress allowlist: only the hosts below are
// reachable, everything else is blocked (private IP ranges are always blocked
// by the platform regardless). The defaults cover the agent runtime, cloning
// from GitHub, and installing packages with npm and pip — the recipe's standard
// workflow. To reach other sources (GitLab, a private registry, an internal Git
// server), add those hosts here. To allow all public hosts instead, set
// ALLOWED_EGRESS = null (the network option is omitted on create).
const ALLOWED_EGRESS = [
  "api.anthropic.com", // required: the in-sandbox runner talks to Anthropic
  "github.com", // git clone over HTTPS
  "codeload.github.com", // GitHub archive/tarball downloads
  "registry.npmjs.org", // npm install
  "pypi.org", // pip install
  "files.pythonhosted.org", // pip package downloads
]

const META_SESSION_ID = "cma.session_id"
const META_WORK_ID = "cma.work_id"
const META_MODE = "cma.mode"
const META_PAUSED_AT = "cma.paused_at"

const RUNNER = `import asyncio, logging, os
from anthropic import AsyncAnthropic

async def main():
    logging.basicConfig(level="INFO")
    key = os.environ["ANTHROPIC_ENVIRONMENT_KEY"]
    async with AsyncAnthropic(auth_token=key) as client:
        await client.beta.environments.work.worker(
            environment_key=key, workdir="/workspace", unrestricted_paths=True, max_idle=300,
        ).handle_item()

asyncio.run(main())
`

const LAUNCH_SCRIPT = `#!/bin/bash
set -eu
cd /workspace
PIDFILE=/workspace/.runner.pid
EXITFILE=/workspace/.runner.exit
rm -f "$PIDFILE" "$EXITFILE"
setsid bash -c 'python3 /workspace/runner.py; printf "%s\\n" "$?" > /workspace/.runner.exit' > /workspace/runner.log 2>&1 < /dev/null &
pid=$!
printf "%s\\n" "$pid" > "$PIDFILE"
echo "$pid"
`

const PROBE_SCRIPT = `#!/bin/bash
set +e
PIDFILE=/workspace/.runner.pid
EXITFILE=/workspace/.runner.exit
if test -f "$EXITFILE"; then
  code=$(head -n1 "$EXITFILE" 2>/dev/null | tr -d '[:space:]')
  printf '{"state":"exited","pid":null,"exit_code":%s}\\n' "\${code:-null}"
  exit 0
fi
if ! test -s "$PIDFILE"; then
  printf '{"state":"no_pidfile","pid":null,"exit_code":null}\\n'
  exit 0
fi
pid=$(head -n1 "$PIDFILE" 2>/dev/null | tr -d '[:space:]')
if kill -0 "$pid" 2>/dev/null; then
  printf '{"state":"running","pid":%s,"exit_code":null}\\n' "$pid"
else
  printf '{"state":"dead","pid":%s,"exit_code":null}\\n' "$pid"
fi
`

const STOP_SCRIPT = `#!/bin/bash
set +e
PIDFILE=/workspace/.runner.pid
EXITFILE=/workspace/.runner.exit
if test -s "$PIDFILE"; then
  pid=$(head -n1 "$PIDFILE" 2>/dev/null | tr -d '[:space:]')
  if test -n "$pid" && kill -0 "$pid" 2>/dev/null; then
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    if test -n "$pgid"; then
      kill -TERM "-$pgid" 2>/dev/null
    else
      kill -TERM "$pid" 2>/dev/null
    fi
    for i in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "-\${pgid:-$pid}" 2>/dev/null
    fi
  fi
fi
rm -f "$PIDFILE" "$EXITFILE"
`

const lastActive = new Map()
let shuttingDown = false

function acquireLock() {
  const lockPath = `/tmp/superserve-cma-${ENVIRONMENT_ID}.lock`
  if (existsSync(lockPath)) {
    try {
      const pid = parseInt(readFileSync(lockPath, "utf8").match(/pid=(\d+)/)?.[1], 10)
      if (pid) {
        process.kill(pid, 0)
        throw new Error(`another orchestrator is already running for environment ${ENVIRONMENT_ID}`)
      }
    } catch (err) {
      if (err.code === "ESRCH") {
        try { unlinkSync(lockPath) } catch {}
      } else if (err.message?.includes("another orchestrator")) {
        throw err
      }
    }
  }
  try {
    writeFileSync(lockPath, `pid=${process.pid} env=${ENVIRONMENT_ID}\n`, { flag: "wx" })
  } catch (err) {
    throw new Error(`cannot create lock file ${lockPath}: ${err.message}`, { cause: err })
  }
  process.on("exit", () => { try { unlinkSync(lockPath) } catch {} })
}

async function installScripts(sandbox) {
  await Promise.all([
    sandbox.files.write("/workspace/.launch.sh", LAUNCH_SCRIPT),
    sandbox.files.write("/workspace/.probe.sh", PROBE_SCRIPT),
    sandbox.files.write("/workspace/.stop.sh", STOP_SCRIPT),
    sandbox.files.write("/workspace/runner.py", RUNNER),
  ])
}

async function runnerState(sandbox) {
  try {
    const result = await sandbox.commands.run("bash /workspace/.probe.sh")
    const lines = result.stdout.trim().split("\n")
    if (lines.length > 0) return JSON.parse(lines[lines.length - 1])
  } catch {}
  return { state: "unknown", pid: null, exit_code: null }
}

async function stopRunner(sandbox) {
  try {
    await sandbox.commands.run("bash /workspace/.stop.sh")
  } catch (e) {
    console.warn(`failed to stop runner in sandbox=${sandbox.id}: ${e.message}`)
  }
}

async function fetchRunnerLog(sandbox) {
  try {
    return await sandbox.files.readText("/workspace/runner.log")
  } catch (e) {
    return `(could not read runner.log: ${e.message})`
  }
}

async function updateMetadata(sandbox, updates) {
  const info = await sandbox.getInfo()
  const meta = { ...info.metadata }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete meta[key]
    else meta[key] = value
  }
  await sandbox.update({ metadata: meta })
}

async function findOrCreateSandbox(sessionId, workId, metadata) {
  if (metadata?.["superserve.sandbox_id"]) {
    const sandboxId = metadata["superserve.sandbox_id"]
    console.log(`attaching prepared sandbox=${sandboxId} for session=${sessionId}`)
    const sandbox = await Sandbox.connect(sandboxId)
    if (sandbox.status === "paused") await sandbox.resume()
    await updateMetadata(sandbox, {
      [META_SESSION_ID]: sessionId, [META_WORK_ID]: workId, [META_MODE]: "active", [META_PAUSED_AT]: null,
    })
    return sandbox
  }

  const existing = await Sandbox.list({ metadata: { [META_SESSION_ID]: sessionId } })
  const live = existing.filter((s) => s.status === "active" || s.status === "paused")

  if (live.length > 0) {
    const sandbox = await Sandbox.connect(live[0].id)
    if (live[0].status === "paused") {
      console.log(`resuming sandbox=${live[0].id} for session=${sessionId}`)
      await sandbox.resume()
    }
    await updateMetadata(sandbox, {
      [META_WORK_ID]: workId, [META_MODE]: "active", [META_PAUSED_AT]: null,
    })
    return sandbox
  }

  console.log(`creating sandbox for session=${sessionId}`)
  return await Sandbox.create({
    name: `cma-${sessionId.slice(0, 8)}`,
    fromTemplate: TEMPLATE_NAME,
    metadata: { [META_SESSION_ID]: sessionId, [META_WORK_ID]: workId, [META_MODE]: "active" },
    network: ALLOWED_EGRESS ? { allowOut: ALLOWED_EGRESS } : undefined,
  })
}

async function handleWork(work) {
  const sessionId = work.data.id
  console.log(`claimed work=${work.id} session=${sessionId}`)

  const sessionMetadata = work.data.metadata ?? null
  const sandbox = await findOrCreateSandbox(sessionId, work.id, sessionMetadata)

  const state = await runnerState(sandbox)
  if (state.state === "running") {
    console.log(`runner already alive pid=${state.pid} in sandbox=${sandbox.id}`)
    lastActive.set(sessionId, Date.now())
    return
  }

  await installScripts(sandbox)
  await stopRunner(sandbox)

  const result = await sandbox.commands.run("bash /workspace/.launch.sh", {
    env: {
      ANTHROPIC_ENVIRONMENT_KEY: ENVIRONMENT_KEY,
      ANTHROPIC_WORK_ID: work.id,
      ANTHROPIC_SESSION_ID: sessionId,
      ANTHROPIC_ENVIRONMENT_ID: ENVIRONMENT_ID,
    },
  })

  let launchedPid
  try {
    const lines = result.stdout.trim().split("\n")
    launchedPid = parseInt(lines[lines.length - 1])
    if (isNaN(launchedPid)) throw new Error("NaN")
  } catch {
    const log = await fetchRunnerLog(sandbox)
    console.error(`runner launch did not report PID sandbox=${sandbox.id}\n${log.slice(0, 500)}`)
    return
  }

  await new Promise((r) => setTimeout(r, 2000))
  const postState = await runnerState(sandbox)
  if (
    !["running", "exited"].includes(postState.state) ||
    (postState.state === "exited" && postState.exit_code !== 0)
  ) {
    const log = await fetchRunnerLog(sandbox)
    console.error(
      `runner failed sandbox=${sandbox.id} pid=${launchedPid} state=${postState.state} exit=${postState.exit_code}\n${log.slice(0, 500)}`
    )
    return
  }

  lastActive.set(sessionId, Date.now())
  console.log(`runner started pid=${launchedPid} sandbox=${sandbox.id} session=${sessionId}`)
}

async function janitorLoop() {
  while (!shuttingDown) {
    await new Promise((r) => setTimeout(r, JANITOR_INTERVAL))
    if (shuttingDown) return

    try {
      const sandboxes = await Sandbox.list()
      const now = Date.now()

      for (const s of sandboxes) {
        if (s.status !== "active") continue
        const sessionId = (s.metadata || {})[META_SESSION_ID]
        if (!sessionId) continue
        if (now - (lastActive.get(sessionId) || 0) < IDLE_TIMEOUT) continue

        try {
          const sandbox = await Sandbox.connect(s.id)
          const state = await runnerState(sandbox)
          if (state.state === "running") {
            lastActive.set(sessionId, now)
            continue
          }
          console.log(`pausing idle sandbox=${s.id} session=${sessionId}`)
          await updateMetadata(sandbox, { [META_PAUSED_AT]: new Date().toISOString() })
          await sandbox.pause()
        } catch (e) {
          console.warn(`janitor: sandbox=${s.id} error: ${e.message}`)
        }
      }
    } catch (e) {
      console.warn(`janitor error: ${e.message}`)
    }
  }
}

async function pollLoop() {
  let backoff = 0
  const client = new Anthropic({ authToken: ENVIRONMENT_KEY })
  console.log(`polling env=${ENVIRONMENT_ID} template=${TEMPLATE_NAME}`)

  while (!shuttingDown) {
    try {
      for await (const work of client.beta.environments.work.poller({
        environmentId: ENVIRONMENT_ID,
        environmentKey: ENVIRONMENT_KEY,
        blockMs: 999,
        reclaimOlderThanMs: 2000,
        autoStop: false,
      })) {
        backoff = 0
        try {
          await handleWork(work)
        } catch (e) {
          console.error(`failed work=${work.id}: ${e.message}`)
        }
      }
    } catch (e) {
      backoff = Math.min(backoff + 1, 6)
      const wait = Math.min(60_000, 2 ** backoff * 1000)
      console.warn(`poll error, retrying in ${wait / 1000}s: ${e.message}`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

acquireLock()
process.once("SIGTERM", () => { shuttingDown = true })
process.once("SIGINT", () => { shuttingDown = true })
await Promise.all([pollLoop(), janitorLoop()])
