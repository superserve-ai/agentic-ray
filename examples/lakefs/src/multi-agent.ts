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

/**
 * Creates the secret once, then treats the current environment value as the
 * source of truth on reruns. Refuse to rotate a same-named secret with a
 * different host or auth type because another integration may own it.
 */
async function ensureApiSecret(name: string, hostname: string, value: string) {
  try {
    const existing = await Secret.get(name)
    if (
      existing.authType !== "basic" ||
      existing.hosts.length !== 1 ||
      existing.hosts[0] !== hostname
    ) {
      throw new Error(
        `Superserve secret ${name} exists with auth=${existing.authType} ` +
          `and hosts=${JSON.stringify(existing.hosts)}; expected basic auth ` +
          `scoped only to ${hostname}. Recreate it or use a different name.`,
      )
    }
    await existing.rotate(value)
    console.log(`rotated existing Superserve secret ${name}`)
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

// Disable stale remount caching and route object traffic through lakeFS until
// the Superserve egress proxy preserves Content-Length on presigned uploads.
// See the integration guide for the full rationale.
const MOUNT_FLAGS = "--protocol fuse --k2=false --presign=false"

/** Branch create/merge/delete go through lakeFS's native REST API -- Everest has no concept of its own. */
async function createBranch(
  sandbox: Sandbox,
  endpoint: string,
  repository: string,
  branch: string,
  source: string,
): Promise<void> {
  const result = await sandbox.commands.run(
    `curl --fail-with-body --silent --show-error --user "$EVEREST_LAKEFS_CREDENTIALS_ACCESS_KEY_ID:$EVEREST_LAKEFS_CREDENTIALS_SECRET_ACCESS_KEY" ` +
      `--header "Content-Type: application/json" --data '${JSON.stringify({ name: branch, source })}' ` +
      `"${endpoint}/api/v1/repositories/${repository}/branches"`,
  )
  assertCommandSucceeded(result, `create branch ${branch}`)
}

async function deleteBranch(
  sandbox: Sandbox,
  endpoint: string,
  repository: string,
  branch: string,
): Promise<void> {
  const result = await sandbox.commands.run(
    `curl --fail-with-body --silent --show-error --request DELETE --user "$EVEREST_LAKEFS_CREDENTIALS_ACCESS_KEY_ID:$EVEREST_LAKEFS_CREDENTIALS_SECRET_ACCESS_KEY" ` +
      `"${endpoint}/api/v1/repositories/${repository}/branches/${branch}"`,
  )
  assertCommandSucceeded(result, `delete branch ${branch}`)
}

async function mergeBranch(
  sandbox: Sandbox,
  endpoint: string,
  repository: string,
  source: string,
  destination: string,
): Promise<string> {
  const result = await sandbox.commands.run(
    `curl --fail-with-body --silent --show-error --user "$EVEREST_LAKEFS_CREDENTIALS_ACCESS_KEY_ID:$EVEREST_LAKEFS_CREDENTIALS_SECRET_ACCESS_KEY" ` +
      `--header "Content-Type: application/json" --data '${JSON.stringify({ message: `Merge ${source} into ${destination}` })}' ` +
      `"${endpoint}/api/v1/repositories/${repository}/refs/${source}/merge/${destination}"`,
  )
  assertCommandSucceeded(result, `merge ${source} into ${destination}`)
  return result.stdout.trim()
}

const agentCount = positiveInteger("LAKEFS_AGENT_COUNT", 2)
const baseRef = "main"
const mountPath = "/mnt/lakefs"
const verifyMountPath = "/mnt/lakefs-verify"
const outputPrefix = "results"
const runId = randomUUID().slice(0, 8)
const transactionBranch = `superserve-${runId}-transaction`
const templateName = "lakefs-everest-demo"
const secretName = "lakefs-secret"

const endpoint = requiredEndpoint("LAKEFS_ENDPOINT")
const repository = requiredIdentifier("LAKEFS_REPOSITORY")
const accessKeyId = required("LAKEFS_ACCESS_KEY_ID")
// The only place the real lakeFS secret key enters this orchestrator
// process. It's stored once as a host-scoped Superserve Secret. Everest and
// the branch/merge calls share that binding, so the real value never enters a
// sandbox.
const realSecretAccessKey = required("LAKEFS_SECRET_ACCESS_KEY")

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
let transactionBranchCreated = false

try {
  for (let index = 0; index < agentCount; index += 1) {
    const sandbox = await Sandbox.create({
      name: `lakefs-${runId}-agent-${index + 1}`,
      fromTemplate: template,
      envVars: {
        EVEREST_LAKEFS_SERVER_ENDPOINT_URL: endpoint,
        EVEREST_LAKEFS_CREDENTIALS_ACCESS_KEY_ID: accessKeyId,
      },
      secrets: {
        EVEREST_LAKEFS_CREDENTIALS_SECRET_ACCESS_KEY: secretName,
      },
      metadata: { integration: "lakefs", run: runId },
    })
    sandboxes.push(sandbox)
  }

  await createBranch(
    sandboxes[0],
    endpoint,
    repository,
    transactionBranch,
    baseRef,
  )
  transactionBranchCreated = true
  console.log(`created transaction branch ${transactionBranch} from ${baseRef}`)

  const results = await Promise.allSettled(
    sandboxes.map(async (sandbox, index) => {
      const branch = branches[index]

      await createBranch(
        sandbox,
        endpoint,
        repository,
        branch,
        transactionBranch,
      )
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
        },
        timeoutMs: 30 * 60_000,
      })
      assertCommandSucceeded(run, `agent ${index + 1} worker`)

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

  for (const branch of branches) {
    const merge = await mergeBranch(
      sandboxes[0],
      endpoint,
      repository,
      branch,
      transactionBranch,
    )
    console.log(`merged ${branch} into ${transactionBranch}\n${merge}`)
  }

  // Validate the complete batch before the one merge that publishes it to
  // main. Consumers of main therefore see every result or none of them.
  console.log("validating the transaction from a fresh read-only mount...")
  await sandboxes[0].commands.run(`mkdir -p ${verifyMountPath}`)
  const verifyMount = await sandboxes[0].commands.run(
    `everest mount lakefs://${repository}/${transactionBranch}/ ${verifyMountPath} ${MOUNT_FLAGS}`,
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

  const publish = await mergeBranch(
    sandboxes[0],
    endpoint,
    repository,
    transactionBranch,
    baseRef,
  )
  console.log(
    `atomically published ${transactionBranch} to ${baseRef}\n${publish}`,
  )

  console.log(
    `completed run ${runId}; results are under ${outputPrefix}/ on ${baseRef}`,
  )
} finally {
  if (transactionBranchCreated && sandboxes[0]) {
    try {
      await deleteBranch(sandboxes[0], endpoint, repository, transactionBranch)
      console.log(`deleted transaction branch ${transactionBranch}`)
    } catch (error) {
      console.error(
        `failed to delete transaction branch ${transactionBranch}:`,
        error,
      )
    }
  }

  const cleanup = await Promise.allSettled(
    sandboxes.map(async (sandbox) => {
      await sandbox.commands.run(`everest umount ${mountPath}`)
      await sandbox.kill()
    }),
  )
  cleanup.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `failed to clean up sandbox ${sandboxes[index].id}:`,
        result.reason,
      )
    }
  })
}
