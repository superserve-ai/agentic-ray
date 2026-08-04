import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { NotFoundError, Sandbox, Secret, Template } from "@superserve/sdk"
import type { BuildStep } from "@superserve/sdk"

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

/**
 * Config that ends up interpolated into a shell command below (curl URLs,
 * template build steps) is restricted to a conservative charset first. These
 * values come from the operator's own environment rather than an untrusted
 * caller, but an example that gets copy-pasted into a CI job -- where they
 * may come from a pipeline variable -- shouldn't hand a `$(...)` or a quote
 * straight to a shell.
 */
function matching(name: string, pattern: RegExp, value: string): string {
  if (!pattern.test(value)) {
    throw new Error(`${name} must match ${pattern}`)
  }
  return value
}

/** lakeFS repository and ref names: alphanumerics, dash, underscore, dot. */
const LAKEFS_IDENTIFIER = /^[A-Za-z0-9._-]+$/

function requiredIdentifier(name: string): string {
  return matching(name, LAKEFS_IDENTIFIER, required(name))
}

/** Rejects credentials, query strings, and anything a shell would expand. */
function requiredEndpoint(name: string): string {
  const raw = required(name)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must use http or https`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `${name} must not contain credentials, a query, or a fragment`,
    )
  }
  return matching(name, /^[A-Za-z0-9:/._-]+$/, raw.replace(/\/+$/, ""))
}

// Everest is proprietary and requires lakeFS Cloud or Enterprise. Obtain the
// Linux x86_64 binary, or an authorized download URL for it, from lakeFS --
// this example deliberately ships no URL or checksum of its own, so nothing
// here redistributes lakeFS's artifact. Supply both: the checksum is
// required so the build step verifies what it fetched rather than trusting
// the download.
const EVEREST_DOWNLOAD_URL = matching(
  "EVEREST_DOWNLOAD_URL",
  /^https:\/\/[A-Za-z0-9:/._-]+$/,
  required("EVEREST_DOWNLOAD_URL"),
)
const EVEREST_SHA256 = matching(
  "EVEREST_SHA256",
  /^[a-f0-9]{64}$/,
  required("EVEREST_SHA256"),
)

function relativePath(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback
  if (!value || value.startsWith("/") || value.includes("..")) {
    throw new Error(
      `${name} must be a non-empty relative path with no ".." segments`,
    )
  }
  return value.replace(/\/+$/, "")
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) {
    throw new Error(`${name} must be an integer between 1 and 16`)
  }
  return value
}

function assertCommandSucceeded(
  result: Awaited<ReturnType<Sandbox["commands"]["run"]>>,
  context: string,
): void {
  if (result.exitCode !== 0) {
    throw new Error(`${context} failed: ${result.stderr || result.stdout}`)
  }
}

/** Idempotent: reuses the secret if it already exists, so reruns don't fail. */
async function ensureApiSecret(name: string, hostname: string, value: string) {
  try {
    await Secret.get(name)
    console.log(`reusing existing Superserve secret ${name}`)
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
    await Secret.create({
      name,
      value,
      hosts: [hostname],
      auth: { type: "basic" },
    })
    console.log(`created Superserve secret ${name}`)
  }
}

/**
 * Idempotent: reuses the template if it already exists and is ready. The
 * build step fetches Everest from the URL you supply and verifies it against
 * the checksum you supply -- see EVEREST_DOWNLOAD_URL above. Mounting also
 * requires the target lakeFS deployment to be Cloud or Enterprise; Everest
 * checks that entitlement against the server at mount time, independently of
 * the credentials used to authenticate.
 */
async function ensureTemplate(name: string): Promise<string> {
  // Template.connect() takes a template ID, not a name, despite its
  // `nameOrId` parameter -- the API rejects a non-UUID. Resolve the name
  // through list() and hand the resolved ID to Sandbox.create.
  const existing = (await Template.list({ namePrefix: name })).find(
    (t) => t.name === name,
  )
  if (existing) {
    if (existing.status === "failed") {
      throw new Error(
        `template ${name} previously failed to build; delete it and rerun`,
      )
    }
    if (existing.status !== "ready") {
      console.log(`waiting for existing template ${name} to finish building...`)
      await (
        await Template.connect(existing.id)
      ).waitUntilReady({
        onLog: (event) => console.log(`[template build] ${event.text}`),
      })
    } else {
      console.log(`reusing existing template ${name}`)
    }
    return existing.id
  }

  console.log(`building template ${name}...`)
  const steps: BuildStep[] = [
    {
      run: "apt-get update && apt-get install -y ca-certificates curl python3 util-linux fuse3",
    },
    {
      run: [
        `curl -sL -o /tmp/everest.tar.gz ${EVEREST_DOWNLOAD_URL}`,
        `echo '${EVEREST_SHA256}  /tmp/everest.tar.gz' | sha256sum -c -`,
        "tar xzf /tmp/everest.tar.gz -C /usr/local/bin everest",
        "chmod +x /usr/local/bin/everest",
        "rm /tmp/everest.tar.gz",
      ].join(" && "),
    },
  ]
  const built = await Template.create({ name, from: "ubuntu:24.04", steps })
  await built.waitUntilReady({
    onLog: (event) => console.log(`[template build] ${event.text}`),
  })
  console.log(`template ${name} ready`)
  return built.id
}

// Mount flags, kept together so the reasoning lives in one place.
//
// --k2=false   Everest's default cache can serve a stale read after a remount
//              of a ref that changed elsewhere, while still reporting the
//              correct commit ID. The read-back verification below depends on
//              that not happening.
//
// --presign=false
//              Routes object data through the lakeFS server instead of
//              presigned URLs straight to the object store. Without it,
//              `everest commit` fails in a real sandbox: Superserve's secrets
//              proxy rebuilds outbound requests without setting
//              ContentLength, so Go frames the upload as
//              `Transfer-Encoding: chunked`, and S3 rejects chunked PutObject
//              with 501 NotImplemented. Presigned uploads carry no
//              substitutable credential (auth is in the query string), so the
//              alternative -- excluding the object store via NO_PROXY -- also
//              works, but it exempts that whole host from egress policy and
//              is object-store specific. Drop this flag once the proxy sets
//              ContentLength; presigned transfers are faster.
const MOUNT_FLAGS = "--protocol fuse --k2=false --presign=false"

/** Branch create/merge go through lakeFS's native REST API -- Everest has no concept of its own. */
async function createBranch(
  sandbox: Sandbox,
  endpoint: string,
  repository: string,
  branch: string,
  source: string,
): Promise<void> {
  const result = await sandbox.commands.run(
    `curl --fail-with-body --silent --show-error --user "$LAKEFS_ACCESS_KEY_ID:$LAKEFS_API_SECRET_ACCESS_KEY" ` +
      `--header "Content-Type: application/json" --data '${JSON.stringify({ name: branch, source })}' ` +
      `"${endpoint}/api/v1/repositories/${repository}/branches"`,
  )
  assertCommandSucceeded(result, `create branch ${branch}`)
}

async function mergeBranch(
  sandbox: Sandbox,
  endpoint: string,
  repository: string,
  source: string,
  destination: string,
): Promise<string> {
  const result = await sandbox.commands.run(
    `curl --fail-with-body --silent --show-error --user "$LAKEFS_ACCESS_KEY_ID:$LAKEFS_API_SECRET_ACCESS_KEY" ` +
      `--header "Content-Type: application/json" --data '${JSON.stringify({ message: `Merge ${source} into ${destination}` })}' ` +
      `"${endpoint}/api/v1/repositories/${repository}/refs/${source}/merge/${destination}"`,
  )
  assertCommandSucceeded(result, `merge ${source} into ${destination}`)
  return result.stdout.trim()
}

const agentCount = positiveInteger("LAKEFS_AGENT_COUNT", 2)
const baseRef = matching(
  "LAKEFS_BASE_REF",
  LAKEFS_IDENTIFIER,
  process.env.LAKEFS_BASE_REF?.trim() || "main",
)
const mountPath = "/mnt/lakefs"
const verifyMountPath = "/mnt/lakefs-verify"
const runId = randomUUID().slice(0, 8)
const templateName =
  process.env.SUPERSERVE_LAKEFS_TEMPLATE?.trim() || "lakefs-everest-demo"
const keepSandboxes = process.env.KEEP_SANDBOXES === "1"
const mergeResults = process.env.LAKEFS_MERGE_RESULTS !== "0"
const demoPauseResume = process.env.LAKEFS_DEMO_PAUSE_RESUME === "1"

const endpoint = requiredEndpoint("LAKEFS_ENDPOINT")
const repository = requiredIdentifier("LAKEFS_REPOSITORY")
const accessKeyId = required("LAKEFS_ACCESS_KEY_ID")
const secretName = process.env.LAKEFS_SECRET_NAME?.trim() || "lakefs-secret"
// The only place the real lakeFS secret key enters this orchestrator
// process. It's stored once as a Superserve Secret and bound under two env
// var names in every sandbox -- Everest's own lakeFS API calls use plain
// HTTP Basic auth (confirmed against a real instance), so the same
// host-scoped Secret substitution that covers the branch/merge calls also
// covers the mount. The real value never enters a sandbox at all.
const realSecretAccessKey = required("LAKEFS_SECRET_ACCESS_KEY")

const inputPrefix = relativePath("LAKEFS_INPUT_PREFIX", "input")
const outputPrefix = relativePath("LAKEFS_OUTPUT_PREFIX", "results")
if (
  inputPrefix === outputPrefix ||
  inputPrefix.startsWith(`${outputPrefix}/`) ||
  outputPrefix.startsWith(`${inputPrefix}/`)
) {
  throw new Error(
    "LAKEFS_INPUT_PREFIX and LAKEFS_OUTPUT_PREFIX must not overlap",
  )
}

await ensureApiSecret(
  secretName,
  new URL(endpoint).hostname,
  realSecretAccessKey,
)
const template = await ensureTemplate(templateName)

const branches = Array.from(
  { length: agentCount },
  (_, index) => `superserve-${runId}-agent-${index + 1}`,
)
const sandboxes: Sandbox[] = []
const worker = await readFile(new URL("../worker.py", import.meta.url), "utf8")

try {
  for (let index = 0; index < agentCount; index += 1) {
    const sandbox = await Sandbox.create({
      name: `lakefs-${runId}-agent-${index + 1}`,
      fromTemplate: template,
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
      metadata: { integration: "lakefs", run: runId },
    })
    sandboxes.push(sandbox)
  }

  const results = await Promise.allSettled(
    sandboxes.map(async (sandbox, index) => {
      const branch = branches[index]

      await createBranch(sandbox, endpoint, repository, branch, baseRef)
      await sandbox.commands.run(`mkdir -p ${mountPath}`)
      const mount = await sandbox.commands.run(
        `everest mount lakefs://${repository}/${branch}/ ${mountPath} ${MOUNT_FLAGS} --write-mode`,
      )
      assertCommandSucceeded(mount, `agent ${index + 1} mount`)

      await sandbox.files.write("/tmp/lakefs-worker.py", worker)
      const run = await sandbox.commands.run("python3 /tmp/lakefs-worker.py", {
        env: {
          AGENT_COUNT: String(agentCount),
          AGENT_INDEX: String(index),
          INPUT_PREFIX: inputPrefix,
          MOUNT_PATH: mountPath,
          OUTPUT_PREFIX: outputPrefix,
        },
        timeoutMs: 30 * 60_000,
      })
      assertCommandSucceeded(run, `agent ${index + 1} worker`)

      // Demo beat: show a Superserve sandbox's long-running, stateful
      // pause/resume surviving an active lakeFS mount. Only the first
      // agent, and only when explicitly requested, so it can't destabilize
      // the main run close to a deadline.
      if (demoPauseResume && index === 0) {
        console.log(
          `agent ${index + 1}: pausing sandbox to demo pause/resume...`,
        )
        const pausedAt = Date.now()
        await sandbox.pause()
        await sandbox.resume()
        const health = await sandbox.commands.run(`mountpoint -q ${mountPath}`)
        assertCommandSucceeded(
          health,
          `agent ${index + 1} mount health after resume`,
        )
        console.log(
          `agent ${index + 1}: resumed after ${Date.now() - pausedAt}ms, mount still healthy`,
        )
      }

      const commit = await sandbox.commands.run(
        `everest commit ${mountPath} -m "Superserve agent ${index + 1} dataset summary"`,
      )
      assertCommandSucceeded(commit, `agent ${index + 1} commit`)
      console.log(`agent ${index + 1}: ${branch}\n${commit.stdout}`)
    }),
  )

  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )
  if (failure) throw failure.reason

  if (mergeResults) {
    for (const branch of branches) {
      const merge = await mergeBranch(
        sandboxes[0],
        endpoint,
        repository,
        branch,
        baseRef,
      )
      console.log(`merged ${branch} into ${baseRef}\n${merge}`)
    }

    // Read-back verification: don't just assert success in a log line --
    // mount baseRef read-only fresh (a mount path no agent has touched) and
    // check every agent's result file actually landed after the merge.
    console.log("verifying merged results from a fresh read-only mount...")
    await sandboxes[0].commands.run(`mkdir -p ${verifyMountPath}`)
    const verifyMount = await sandboxes[0].commands.run(
      `everest mount lakefs://${repository}/${baseRef}/ ${verifyMountPath} ${MOUNT_FLAGS}`,
    )
    assertCommandSucceeded(verifyMount, "read-back verification mount")
    try {
      for (let index = 0; index < agentCount; index += 1) {
        const path = `${verifyMountPath}/${outputPrefix}/agent-${index + 1}.json`
        const read = await sandboxes[0].commands.run(
          `cat ${JSON.stringify(path)}`,
        )
        assertCommandSucceeded(read, `verify agent ${index + 1} result`)
        const parsed = JSON.parse(read.stdout)
        if (parsed.agent !== index + 1) {
          throw new Error(
            `verification failed: ${path} has agent=${parsed.agent}, expected ${index + 1}`,
          )
        }
        console.log(`verified agent ${index + 1}: ${read.stdout.trim()}`)
      }
      console.log("read-back verification passed for all agents")
    } finally {
      await sandboxes[0].commands.run(`everest umount ${verifyMountPath}`)
    }

    console.log(
      `completed run ${runId}; results verified under ${outputPrefix}/ on ${baseRef}`,
    )
  } else {
    console.log(
      `completed run ${runId}; branches were not merged: ${branches.join(", ")}`,
    )
    console.log(
      "unset LAKEFS_MERGE_RESULTS to merge and verify them on a future run",
    )
  }
} finally {
  if (!keepSandboxes) {
    const cleanup = await Promise.allSettled(
      sandboxes.map(async (sandbox) => {
        try {
          await sandbox.commands.run(`everest umount ${mountPath}`)
        } catch (error) {
          console.warn(`failed to unmount lakeFS from ${sandbox.id}:`, error)
        }
        await sandbox.kill()
      }),
    )
    cleanup.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(
          `failed to kill sandbox ${sandboxes[index].id}:`,
          result.reason,
        )
      }
    })
  } else if (sandboxes.length > 0) {
    console.log(
      `KEEP_SANDBOXES=1; leaving sandboxes running: ${sandboxes.map((sandbox) => sandbox.id).join(", ")}`,
    )
  }
}
