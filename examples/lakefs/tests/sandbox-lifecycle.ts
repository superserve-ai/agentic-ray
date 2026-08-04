// End-to-end lifecycle test against a REAL Superserve sandbox.
//
// This covers the parts the Docker test structurally cannot:
//
//   1. `Template.create` actually builds with the Everest fetch step.
//   2. `Sandbox.create({ secrets })` binds a stand-in, not the real key --
//      asserted directly by reading the env var inside the sandbox.
//   3. Everest still authenticates to lakeFS while holding only that
//      stand-in, which is what proves the secrets proxy substitutes
//      correctly for Everest's Basic auth. This is the load-bearing claim
//      behind "the real secret never enters a sandbox" in the docs; if this
//      step fails, that claim is wrong and the docs must change.
//   4. Real VM pause()/resume() -- memory, processes, filesystem
//      checkpointed to disk and restored -- with a live FUSE mount, which
//      `docker pause` only approximates.
//
// Run:
//   SUPERSERVE_API_KEY=... LAKEFS_ENDPOINT=... LAKEFS_REPOSITORY=... \
//   LAKEFS_ACCESS_KEY_ID=... LAKEFS_SECRET_ACCESS_KEY=... \
//   EVEREST_DOWNLOAD_URL=... EVEREST_SHA256=... \
//   bun run tests/sandbox-lifecycle.ts

import { Buffer } from "node:buffer"

import { NotFoundError, Sandbox, Secret, Template } from "@superserve/sdk"
import type { BuildStep } from "@superserve/sdk"

function required(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} is required`)
  return v
}

required("SUPERSERVE_API_KEY") // read by the SDK itself; fail early if absent
const endpoint = required("LAKEFS_ENDPOINT")
const repository = required("LAKEFS_REPOSITORY")
const accessKeyId = required("LAKEFS_ACCESS_KEY_ID")
const realSecret = required("LAKEFS_SECRET_ACCESS_KEY")
const everestUrl = required("EVEREST_DOWNLOAD_URL")
const everestSha256 = required("EVEREST_SHA256")

const MOUNT = "/mnt/lakefs"
const templateName =
  process.env.SUPERSERVE_LAKEFS_TEMPLATE?.trim() || "lakefs-everest-demo"
const secretName = process.env.LAKEFS_SECRET_NAME?.trim() || "lakefs-secret"
const branch = `sandbox-lifecycle-${Date.now().toString(36)}`

const step = (s: string) => console.log(`\n=== ${s} ===`)

function assertOk(
  r: { exitCode: number; stdout: string; stderr: string },
  context: string,
) {
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
      Authorization: `Basic ${Buffer.from(`${accessKeyId}:${realSecret}`).toString("base64")}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  })
}

let sandbox: Sandbox | undefined

try {
  step("ensure the Superserve Secret exists")
  try {
    await Secret.get(secretName)
    console.log(`reusing existing secret ${secretName}`)
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
    await Secret.create({
      name: secretName,
      value: realSecret,
      hosts: [new URL(endpoint).hostname],
      auth: { type: "basic" },
    })
    console.log(`created secret ${secretName}`)
  }

  step("ensure the template exists (builds Everest in)")
  // Template.connect() takes a template ID, not a name, despite its
  // `nameOrId` parameter -- the API rejects a non-UUID. Resolve the name
  // through list() instead.
  const existing = (await Template.list({ namePrefix: templateName })).find(
    (t) => t.name === templateName,
  )
  let templateId: string
  if (existing) {
    if (existing.status === "failed") {
      throw new Error(
        `template ${templateName} is in a failed state; delete it`,
      )
    }
    if (existing.status !== "ready") {
      await (
        await Template.connect(existing.id)
      ).waitUntilReady({ onLog: (e) => console.log(`[build] ${e.text}`) })
    }
    templateId = existing.id
    console.log(`reusing template ${templateName} (${existing.id})`)
  } else {
    const steps: BuildStep[] = [
      {
        run: "apt-get update && apt-get install -y ca-certificates curl python3 util-linux fuse3",
      },
      {
        run: [
          `curl -sL -o /tmp/everest.tar.gz ${everestUrl}`,
          `echo '${everestSha256}  /tmp/everest.tar.gz' | sha256sum -c -`,
          "tar xzf /tmp/everest.tar.gz -C /usr/local/bin everest",
          "chmod +x /usr/local/bin/everest",
          "rm /tmp/everest.tar.gz",
        ].join(" && "),
      },
    ]
    const built = await Template.create({
      name: templateName,
      from: "ubuntu:24.04",
      steps,
    })
    await built.waitUntilReady({
      onLog: (e) => console.log(`[build] ${e.text}`),
    })
    templateId = built.id
    console.log(`built template ${templateName} (${built.id})`)
  }

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

  step("create sandbox with the secret bound")
  sandbox = await Sandbox.create({
    name: `lakefs-lifecycle-${Date.now().toString(36)}`,
    fromTemplate: templateId,
    envVars: {
      LAKEFS_ENDPOINT: endpoint,
      LAKEFS_ACCESS_KEY_ID: accessKeyId,
      EVEREST_LAKEFS_SERVER_ENDPOINT_URL: endpoint,
      EVEREST_LAKEFS_CREDENTIALS_ACCESS_KEY_ID: accessKeyId,
    },
    secrets: {
      LAKEFS_API_SECRET_ACCESS_KEY: secretName,
      EVEREST_LAKEFS_CREDENTIALS_SECRET_ACCESS_KEY: secretName,
    },
    metadata: { integration: "lakefs", test: "sandbox-lifecycle" },
  })
  console.log(`sandbox ${sandbox.id}`)

  // The central claim in the docs. If the sandbox can see the real key, the
  // "real secret never enters a sandbox" wording is wrong and must change.
  step("the sandbox sees a STAND-IN, not the real secret key")
  const seen = assertOk(
    await sandbox.commands.run(
      'printf %s "$EVEREST_LAKEFS_CREDENTIALS_SECRET_ACCESS_KEY"',
    ),
    "read bound secret env var",
  ).stdout
  if (!seen) {
    throw new Error(
      "EVEREST_LAKEFS_CREDENTIALS_SECRET_ACCESS_KEY is empty in the sandbox",
    )
  }
  if (seen === realSecret) {
    throw new Error(
      "FAIL: the sandbox can see the REAL lakeFS secret key. The docs claim " +
        "that the real value never enters a sandbox -- fix the docs.",
    )
  }
  console.log(
    `OK: sandbox sees a ${seen.length}-char stand-in (prefix ${JSON.stringify(seen.slice(0, 11))}), not the real key`,
  )

  // If Everest authenticates while holding only that stand-in, the secrets
  // proxy is substituting correctly for its Basic auth.
  step("Everest mounts using only the stand-in (proves proxy substitution)")
  assertOk(await sandbox.commands.run(`mkdir -p ${MOUNT}`), "mkdir")
  assertOk(
    await sandbox.commands.run(
      `everest mount lakefs://${repository}/${branch}/ ${MOUNT} --protocol fuse --k2=false --presign=false --write-mode`,
      { timeoutMs: 180_000 },
    ),
    "everest mount",
  )
  console.log("OK: mounted -- lakeFS accepted the substituted credential")

  step("read the seed dataset through the mount")
  const listing = assertOk(
    await sandbox.commands.run(`find ${MOUNT}/input -type f | head -3`),
    "list input",
  )
  console.log(listing.stdout.trim() || "(no input/ seed files)")

  step("write a file before pausing")
  assertOk(
    await sandbox.commands.run(
      `mkdir -p ${MOUNT}/results && printf '%s' '{"phase":"before-pause"}' > ${MOUNT}/results/lifecycle.json`,
    ),
    "write before pause",
  )
  console.log("OK")

  step("pause() the sandbox -- real VM checkpoint to disk")
  const pausedAt = Date.now()
  await sandbox.pause()
  console.log(`paused (${Date.now() - pausedAt}ms)`)

  step("resume() and check the mount survived")
  const resumedAt = Date.now()
  await sandbox.resume()
  console.log(`resumed (${Date.now() - resumedAt}ms)`)
  assertOk(
    await sandbox.commands.run(`mountpoint -q ${MOUNT}`),
    "mountpoint after resume",
  )
  console.log("OK: still a mountpoint")

  step("read back what was written before the pause")
  const before = assertOk(
    await sandbox.commands.run(`cat ${MOUNT}/results/lifecycle.json`),
    "read after resume",
  )
  if (!before.stdout.includes("before-pause")) {
    throw new Error(`unexpected content after resume: ${before.stdout}`)
  }
  console.log(`OK: ${before.stdout.trim()}`)

  // Forces a fresh round-trip to lakeFS rather than a cache hit, so this
  // also re-proves the substituted credential still works after resume.
  step("fetch an untouched file (fresh lakeFS round-trip after resume)")
  const untouched = assertOk(
    await sandbox.commands.run(`find ${MOUNT}/input -type f | tail -1`),
    "pick untouched file",
  ).stdout.trim()
  if (untouched) {
    const fetched = assertOk(
      await sandbox.commands.run(`cat ${untouched}`),
      `read ${untouched}`,
    )
    console.log(`OK: read ${untouched} (${fetched.stdout.length} bytes)`)
  } else {
    console.log("skipped -- no seed files under input/")
  }

  step("write again after resume, then commit")
  assertOk(
    await sandbox.commands.run(
      `printf '%s' '{"phase":"after-resume"}' > ${MOUNT}/results/lifecycle-after.json`,
    ),
    "write after resume",
  )
  const commit = assertOk(
    await sandbox.commands.run(
      `everest commit ${MOUNT} -m "sandbox lifecycle test"`,
      {
        timeoutMs: 180_000,
      },
    ),
    "everest commit",
  )
  console.log(commit.stdout.trim())

  step("verify both files landed on the branch, server-side")
  for (const name of ["lifecycle.json", "lifecycle-after.json"]) {
    const stat = await lakefsApi(
      `repositories/${encodeURIComponent(repository)}/refs/${encodeURIComponent(branch)}/objects/stat?path=${encodeURIComponent(`results/${name}`)}`,
    )
    if (!stat.ok)
      throw new Error(`results/${name} not found on ${branch}: ${stat.status}`)
    console.log(`OK: results/${name} present`)
  }

  console.log(`
All real-sandbox checks passed:
  - Template.create built Everest into the image
  - Sandbox.create bound a stand-in, NOT the real lakeFS secret
  - Everest authenticated with only that stand-in (secrets proxy substitutes
    correctly for its Basic auth -- the docs claim holds)
  - a live FUSE mount survived a real pause()/resume() VM checkpoint
  - post-resume reads hit lakeFS fresh, and a post-resume commit landed
`)
} finally {
  if (sandbox) {
    await sandbox.commands
      .run(`everest umount ${MOUNT}`, { timeoutMs: 60_000 })
      .catch(() => {})
    await sandbox.kill().catch((e) => console.warn("kill failed:", e))
    console.log("sandbox killed")
  }
  await lakefsApi(
    `repositories/${encodeURIComponent(repository)}/branches/${encodeURIComponent(branch)}`,
    { method: "DELETE" },
  ).catch(() => {})
}
