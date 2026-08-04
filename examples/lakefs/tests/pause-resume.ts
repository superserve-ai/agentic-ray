// Does an active Everest mount survive its host being frozen and thawed?
//
// Superserve's pause()/resume() checkpoints the full VM -- memory,
// processes, filesystem -- to disk and restores it. Docker can't do that;
// `docker pause` only freezes the container's processes via the cgroup
// freezer, with no serialize/restore step. So this is an APPROXIMATION, not
// proof that real pause/resume works.
//
// What it does genuinely exercise is the failure mode most likely to bite in
// either case: the mount's HTTP connections to lakeFS sitting idle across the
// suspension window and not recovering afterwards. A stale mount, a dead
// connection pool, or a cache that quietly serves nothing would all show up
// here. Confirming the real thing still needs a run against a real sandbox.
//
// Run:
//   LAKEFS_ENDPOINT=... LAKEFS_REPOSITORY=... LAKEFS_ACCESS_KEY_ID=... \
//   LAKEFS_SECRET_ACCESS_KEY=... EVEREST_DOWNLOAD_URL=... EVEREST_SHA256=... \
//   bun run tests/pause-resume.ts

import { Buffer } from "node:buffer"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const CONTAINER = "lakefs-pause-resume-test"
const MOUNT = "/mnt/lakefs"

function required(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} is required`)
  return v
}

const endpoint = required("LAKEFS_ENDPOINT")
const repository = required("LAKEFS_REPOSITORY")
const accessKeyId = required("LAKEFS_ACCESS_KEY_ID")
const secret = required("LAKEFS_SECRET_ACCESS_KEY")
const everestUrl = required("EVEREST_DOWNLOAD_URL")
const everestSha256 = required("EVEREST_SHA256")
// How long to hold the container frozen. Long enough that an idle connection
// could plausibly be dropped by a peer or NAT; override to probe harder.
const pauseSeconds = Number(process.env.PAUSE_SECONDS?.trim() || "30")

const containerEnv: Record<string, string> = {
  LAKEFS_ACCESS_KEY_ID: accessKeyId,
  LAKEFS_API_SECRET_ACCESS_KEY: secret,
  EVEREST_LAKEFS_SERVER_ENDPOINT_URL: endpoint,
  EVEREST_LAKEFS_CREDENTIALS_ACCESS_KEY_ID: accessKeyId,
  EVEREST_LAKEFS_CREDENTIALS_SECRET_ACCESS_KEY: secret,
}

async function sh(
  command: string,
  timeoutMs = 60_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const args = ["exec"]
  for (const [k, v] of Object.entries(containerEnv))
    args.push("-e", `${k}=${v}`)
  args.push(CONTAINER, "sh", "-c", command)
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { exitCode: 0, stdout, stderr }
  } catch (error) {
    const e = error as {
      code?: number
      stdout?: string
      stderr?: string
      message?: string
    }
    return {
      exitCode: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(e.message ?? error),
    }
  }
}

async function shOk(command: string, context: string, timeoutMs = 60_000) {
  const r = await sh(command, timeoutMs)
  if (r.exitCode !== 0) {
    throw new Error(`${context} failed: ${r.stderr || r.stdout}`)
  }
  return r
}

async function lakefsApi(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<Response> {
  return fetch(`${endpoint}/api/v1/${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accessKeyId}:${secret}`).toString("base64")}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  })
}

const branch = `pause-resume-${Date.now().toString(36)}`
const step = (s: string) => console.log(`\n=== ${s} ===`)

async function setup(): Promise<void> {
  await execFileAsync("docker", ["rm", "-f", CONTAINER]).catch(() => {})
  await execFileAsync("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER,
    "--cap-add",
    "SYS_ADMIN",
    "--device",
    "/dev/fuse",
    "ubuntu:24.04",
    "sleep",
    "infinity",
  ])
  await shOk(
    "apt-get update -qq && apt-get install -y -qq ca-certificates curl util-linux fuse3",
    "install deps",
    180_000,
  )
  await shOk(
    [
      `curl -sL -o /tmp/everest.tar.gz ${everestUrl}`,
      `echo '${everestSha256}  /tmp/everest.tar.gz' | sha256sum -c -`,
      "tar xzf /tmp/everest.tar.gz -C /usr/local/bin everest",
      "chmod +x /usr/local/bin/everest",
    ].join(" && "),
    "install everest",
    120_000,
  )
}

async function teardown(): Promise<void> {
  await execFileAsync("docker", ["unpause", CONTAINER]).catch(() => {})
  await sh(`everest umount ${MOUNT} 2>/dev/null; true`).catch(() => {})
  await execFileAsync("docker", ["rm", "-f", CONTAINER]).catch(() => {})
  await lakefsApi(
    `repositories/${encodeURIComponent(repository)}/branches/${encodeURIComponent(branch)}`,
    { method: "DELETE" },
  ).catch(() => {})
}

console.log(`setting up ${CONTAINER}...`)
await setup()

try {
  step(`create branch ${branch}`)
  const created = await lakefsApi(
    `repositories/${encodeURIComponent(repository)}/branches`,
    { method: "POST", body: { name: branch, source: "main" } },
  )
  if (!created.ok) {
    throw new Error(
      `create branch failed: ${created.status} ${await created.text()}`,
    )
  }
  console.log("OK")

  step("mount the branch write-mode and write a file")
  await shOk(`mkdir -p ${MOUNT}`, "mkdir")
  await shOk(
    `everest mount lakefs://${repository}/${branch}/ ${MOUNT} --protocol fuse --k2=false --presign=false --write-mode`,
    "mount",
    120_000,
  )
  await shOk(
    `mkdir -p ${MOUNT}/results && printf '%s' '{"phase":"before-pause"}' > ${MOUNT}/results/pause-test.json`,
    "write before pause",
  )
  console.log("wrote results/pause-test.json")

  step(`freeze the container for ${pauseSeconds}s (docker pause)`)
  await execFileAsync("docker", ["pause", CONTAINER])
  const frozenAt = Date.now()
  await new Promise((r) => setTimeout(r, pauseSeconds * 1000))
  await execFileAsync("docker", ["unpause", CONTAINER])
  console.log(`thawed after ${Math.round((Date.now() - frozenAt) / 1000)}s`)

  step("mount is still a mountpoint after thaw")
  await shOk(`mountpoint -q ${MOUNT}`, "mountpoint after resume")
  console.log("OK")

  step("read back the file written before the freeze")
  const before = await shOk(
    `cat ${MOUNT}/results/pause-test.json`,
    "read after resume",
  )
  if (!before.stdout.includes("before-pause")) {
    throw new Error(`unexpected content after resume: ${before.stdout}`)
  }
  console.log(`OK: ${before.stdout.trim()}`)

  // The real proof the mount recovered rather than just serving cache: pull
  // a file the mount hasn't touched, which has to go back to lakeFS.
  step("read a file the mount has NOT touched (forces a fresh lakeFS fetch)")
  const listing = await shOk(
    `find ${MOUNT}/input -type f | head -1`,
    "list input",
  )
  const untouched = listing.stdout.trim()
  if (!untouched) {
    throw new Error(
      "no seed files under input/ -- seed the repo before running this",
    )
  }
  const fetched = await shOk(
    `cat ${untouched}`,
    `read ${untouched} after resume`,
  )
  console.log(`OK: read ${untouched} (${fetched.stdout.length} bytes)`)

  step("write again after the freeze, then commit")
  await shOk(
    `printf '%s' '{"phase":"after-resume"}' > ${MOUNT}/results/pause-test-after.json`,
    "write after resume",
  )
  const commit = await shOk(
    `everest commit ${MOUNT} -m "pause/resume test"`,
    "commit after resume",
    120_000,
  )
  console.log(commit.stdout.trim())

  step("verify both files landed on the branch, server-side")
  for (const name of ["pause-test.json", "pause-test-after.json"]) {
    const stat = await lakefsApi(
      `repositories/${encodeURIComponent(repository)}/refs/${encodeURIComponent(branch)}/objects/stat?path=${encodeURIComponent(`results/${name}`)}`,
    )
    if (!stat.ok) {
      throw new Error(`${name} not found on ${branch}: ${stat.status}`)
    }
    console.log(`OK: results/${name} present`)
  }

  console.log(`
Everest mount survived a ${pauseSeconds}s freeze/thaw of its host:
  - mount still valid after thaw
  - data written before the freeze still readable
  - an untouched file fetched fresh from lakeFS (connection recovered)
  - a post-thaw write committed and verified server-side

Caveat: docker pause freezes processes via the cgroup freezer; it does not
serialize and restore memory the way Superserve's pause()/resume() does.
Treat this as strong evidence the mount tolerates suspension, not as proof
of real sandbox pause/resume.
`)
} finally {
  await teardown()
}
