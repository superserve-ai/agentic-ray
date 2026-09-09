// Shared helpers for the spawn hook and the monitor: sandbox tagging, the
// in-sandbox worker supervisor scripts, and the Cursor pool API.
import { Sandbox } from "@superserve/sdk"

export const META_MANAGED = "cursor.managed"
export const META_WORKER_ID = "cursor.worker_id"
export const META_POOL = "cursor.pool"
export const META_REQUEST_ID = "cursor.request_id"
export const META_REPO = "cursor.repo"
// Set by the spawn hook while it resumes and relaunches a paused sandbox, so the
// monitor leaves it alone until the new worker is up (see MONITOR_GRACE_SECONDS).
export const META_LAUNCHING = "cursor.launching"

export const STATE_DIR = "/var/lib/cursor-worker"
const PIDFILE = `${STATE_DIR}/worker.pid`
const EXITFILE = `${STATE_DIR}/worker.exit`
const LOGFILE = `${STATE_DIR}/worker.log`

const POOL_NAME_RE = /^[A-Za-z0-9._-]+$/
const STARTUP_GRACE_MS = 5000

function flag(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  return raw === "true" || raw === "1"
}

// Sandboxes resolve DNS through these public resolvers. A strict allowlist has
// to include them or nothing resolves. Single IPs are written as /32.
const DNS_RESOLVERS = ["1.1.1.1/32", "8.8.8.8/32"]
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

function egressAllowlist(raw) {
  const entries = raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => (IPV4_RE.test(e) ? `${e}/32` : e))
  if (entries.length === 0) return []
  return [...new Set([...DNS_RESOLVERS, ...entries])]
}

export const config = {
  templateName: process.env.CURSOR_WORKER_TEMPLATE || "cursor-worker",
  idleReleaseTimeout: process.env.CURSOR_WORKER_IDLE_RELEASE_TIMEOUT || "600",
  cloneGitRepos: flag("CURSOR_WORKER_CLONE_GIT_REPOS", true),
  hibernate: flag("CURSOR_WORKER_HIBERNATE", false),
  autoDeleteSeconds: Number(process.env.SANDBOX_AUTO_DELETE_SECONDS || 86_400),
  allowOut: egressAllowlist(process.env.CURSOR_WORKER_ALLOW_OUT || ""),
  cursorEndpoint: process.env.CURSOR_API_ENDPOINT || "https://api.cursor.com",
}

const PROBE_SCRIPT = `#!/bin/bash
set +e
if test -f "${EXITFILE}"; then
  code=$(head -n1 "${EXITFILE}" 2>/dev/null | tr -d '[:space:]')
  printf '{"state":"exited","pid":null,"exit_code":%s}\\n' "\${code:-null}"
  exit 0
fi
if ! test -s "${PIDFILE}"; then
  printf '{"state":"no_pidfile","pid":null,"exit_code":null}\\n'
  exit 0
fi
pid=$(head -n1 "${PIDFILE}" 2>/dev/null | tr -d '[:space:]')
if kill -0 "$pid" 2>/dev/null; then
  printf '{"state":"running","pid":%s,"exit_code":null}\\n' "$pid"
else
  printf '{"state":"dead","pid":%s,"exit_code":null}\\n' "$pid"
fi
`

const STOP_SCRIPT = `#!/bin/bash
set +e
if test -s "${PIDFILE}"; then
  pid=$(head -n1 "${PIDFILE}" 2>/dev/null | tr -d '[:space:]')
  if test -n "$pid" && kill -0 "$pid" 2>/dev/null; then
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    kill -TERM "-\${pgid:-$pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    for i in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$pid" 2>/dev/null && kill -KILL "-\${pgid:-$pid}" 2>/dev/null
  fi
fi
rm -f "${PIDFILE}" "${EXITFILE}"
`

// The worker runs detached from the exec session (setsid) so it outlives the
// API call that started it. The command itself lives in run.sh so no shell
// quoting is involved; the exit code lands in EXITFILE for the probe.
const RUNFILE = `${STATE_DIR}/run.sh`
const LAUNCH_SCRIPT = `#!/bin/bash
set -eu
export HOME="\${HOME:-/root}"
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
mkdir -p "${STATE_DIR}" /workspace
cd /workspace
rm -f "${PIDFILE}" "${EXITFILE}"
setsid bash -c 'bash "${RUNFILE}"; printf "%s\\n" "$?" > "${EXITFILE}"' > "${LOGFILE}" 2>&1 < /dev/null &
pid=$!
printf "%s\\n" "$pid" > "${PIDFILE}"
echo "$pid"
`

function runScript(workerCommand) {
  return `#!/bin/bash\nexec ${workerCommand}\n`
}

export function workerCommand(pool) {
  if (!POOL_NAME_RE.test(pool)) throw new Error(`invalid pool name: ${pool}`)
  const args = ["agent", "worker", "--pool", pool]
  if (config.cloneGitRepos) args.push("--clone-git-repos")
  args.push("start")
  return args.join(" ")
}

// Env handed to the worker process. CURSOR_API_KEY is scoped to this command,
// not the whole sandbox, so it is not visible to unrelated exec calls.
export function workerEnv({ workerId, workerName }) {
  const env = {
    CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    CURSOR_AGENT_WORKER_ID: workerId,
    CURSOR_WORKER_IDLE_RELEASE_TIMEOUT: config.idleReleaseTimeout,
  }
  if (workerName) env.CURSOR_WORKER_NAME = workerName
  for (const key of ["CURSOR_API_URL", "CURSOR_API_ENDPOINT"]) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

export async function workerState(sandbox) {
  try {
    const result = await sandbox.commands.run(`bash ${STATE_DIR}/probe.sh`)
    const lines = result.stdout.trim().split("\n")
    if (lines.length > 0 && lines.at(-1)) return JSON.parse(lines.at(-1))
  } catch {
    // fall through
  }
  return { state: "unknown", pid: null, exit_code: null }
}

export async function stopWorker(sandbox) {
  await sandbox.commands.run(`bash ${STATE_DIR}/stop.sh`)
}

export async function readLog(sandbox) {
  try {
    return await sandbox.files.readText(LOGFILE)
  } catch (e) {
    return `(could not read ${LOGFILE}: ${e.message})`
  }
}

// `command` overrides the worker command; tests use it to run a stand-in process.
export async function launchWorker(sandbox, { pool, env, command }) {
  await sandbox.commands.run(`mkdir -p ${STATE_DIR}`)
  await Promise.all([
    sandbox.files.write(`${STATE_DIR}/launch.sh`, LAUNCH_SCRIPT),
    sandbox.files.write(RUNFILE, runScript(command ?? workerCommand(pool))),
    sandbox.files.write(`${STATE_DIR}/probe.sh`, PROBE_SCRIPT),
    sandbox.files.write(`${STATE_DIR}/stop.sh`, STOP_SCRIPT),
  ])

  const result = await sandbox.commands.run(`bash ${STATE_DIR}/launch.sh`, {
    env,
  })
  const pid = Number.parseInt(result.stdout.trim().split("\n").at(-1) ?? "", 10)
  if (Number.isNaN(pid)) {
    return {
      ok: false,
      state: { state: "no_pidfile" },
      log: await readLog(sandbox),
    }
  }

  await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS))
  const state = await workerState(sandbox)
  if (state.state !== "running")
    return { ok: false, state, log: await readLog(sandbox) }
  return { ok: true, pid, state }
}

const LIVE_STATUSES = new Set([
  "starting",
  "active",
  "pausing",
  "paused",
  "resuming",
])

// Merge metadata updates into the sandbox's existing tags. A null value
// removes the key; update() replaces the whole map, so read first.
export async function tagSandbox(sandbox, updates) {
  const info = await sandbox.getInfo()
  const metadata = { ...info.metadata }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete metadata[key]
    else metadata[key] = value
  }
  await sandbox.update({ metadata })
}

export async function findSandboxForWorker(workerId) {
  const matches = await Sandbox.list({
    metadata: { [META_WORKER_ID]: workerId },
  })
  return matches.find((s) => LIVE_STATUSES.has(s.status)) ?? null
}

// --- Cursor pool API (service-account key, Basic auth) ---------------------

async function cursorApi(path, { method = "GET", body } = {}) {
  const auth = Buffer.from(`${process.env.CURSOR_API_KEY}:`).toString("base64")
  const init = {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(`${config.cursorEndpoint}${path}`, init)
  if (!res.ok)
    throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// Hand a claimed request back to the queue when the worker could not start.
export function releaseClaim(requestId) {
  return cursorApi(
    `/v0/private-workers/claims/${encodeURIComponent(requestId)}/release`,
    {
      method: "POST",
    },
  )
}

export async function listPendingRequests(pool) {
  const requests = []
  let pageToken
  do {
    const params = new URLSearchParams({ limit: "100" })
    if (pool) params.set("pool", pool)
    if (pageToken) params.set("pageToken", pageToken)
    const page = await cursorApi(
      `/v0/private-workers/pending-requests?${params}`,
    )
    requests.push(...(page?.requests ?? []))
    pageToken = page?.nextPageToken
  } while (pageToken)
  return requests
}
