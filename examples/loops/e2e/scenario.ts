import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { Sandbox } from "@superserve/sdk"

import { runLoop } from "../lib/run-loop"
import { buildSpec, resolveAuth } from "../pr-loop/loop"

/**
 * End-to-end scenario for the PR Loop. Spins up a throwaway GitHub
 * repo, ships a baseline, opens a PR that plants a logic bug AND a shell
 * injection, runs the REAL loop against it, then prints the review the loop
 * posted. Tears the repo + sandbox down afterward.
 *
 *   SUPERSERVE_API_KEY=ss_live_…  \
 *   ANTHROPIC_API_KEY=sk-ant-…    \   # or CLAUDE_CODE_OAUTH_TOKEN=… (subscription)
 *   GITHUB_TOKEN=ghp_…            \   # needs repo + delete_repo scope
 *     bun run e2e/scenario.ts [--owner <login>] [--keep] [--dry-run]
 *
 * `gh` must be installed locally. `--dry-run` prints the plan and the planted
 * bug without touching GitHub or Superserve (no credentials needed).
 */

const SECS = (ms: number): string => (ms / 1000).toFixed(1)

const BASELINE_DISCOUNT = `// Apply a percentage discount to a price.
function applyDiscount(price, percent) {
  return price - (price * percent) / 100
}

module.exports = { applyDiscount }
`

const BUGGY_DISCOUNT = `const { execSync } = require("node:child_process")

// Subtracts the raw percent instead of computing the percentage.
function applyDiscount(price, percent) {
  return price - percent
}

// Archives an order by id.
function archiveOrder(orderId) {
  return execSync(\`tar czf order-\${orderId}.tgz ./orders/\${orderId}\`).toString()
}

module.exports = { applyDiscount, archiveOrder }
`

const TEST_JS = `const assert = require("node:assert")
const { applyDiscount } = require("./src/discount")

// 10% off 200 should be 180.
assert.strictEqual(applyDiscount(200, 10), 180)
console.log("ok")
`

const SEED_FILES: Record<string, string> = {
  "src/discount.js": BASELINE_DISCOUNT,
  "test.js": TEST_JS,
  "package.json": `${JSON.stringify({ name: "discount-demo", version: "1.0.0", scripts: { test: "node test.js" } }, null, 2)}\n`,
  "CLAUDE.md":
    "# Conventions\n\nRun `npm test` to verify changes. Keep functions pure and side-effect free.\n",
  "README.md": "# discount-demo\n\nA tiny fixture repo for the PR Loop e2e.\n",
}

interface Flags {
  owner?: string
  repoName?: string
  keep: boolean
  dryRun: boolean
}

function parseFlags(args: string[]): Flags {
  const get = (n: string): string | undefined => {
    const eq = args.find((a) => a.startsWith(`${n}=`))
    if (eq) return eq.slice(n.length + 1)
    const i = args.indexOf(n)
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")
      ? args[i + 1]
      : undefined
  }
  return {
    owner: get("--owner"),
    repoName: get("--repo-name"),
    keep: args.includes("--keep"),
    dryRun: args.includes("--dry-run"),
  }
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean } = {},
): string {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: "utf8",
    stdio: opts.capture
      ? ["ignore", "pipe", "pipe"]
      : ["ignore", "inherit", "inherit"],
  })
  if (res.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (exit ${res.status})\n${opts.capture ? `${res.stdout}${res.stderr}` : ""}`,
    )
  }
  return (res.stdout ?? "").trim()
}

function seed(dir: string): void {
  for (const [rel, body] of Object.entries(SEED_FILES)) {
    const target = join(dir, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
}

function printPlan(owner: string, repoName: string): void {
  console.log("e2e plan (dry run — nothing created):\n")
  console.log(`  repo:        ${owner}/${repoName} (private, throwaway)`)
  console.log(`  baseline:    ${Object.keys(SEED_FILES).join(", ")}`)
  console.log("  PR branch:   fix/discount — plants two issues:")
  console.log(
    "    1. logic bug: applyDiscount returns price - percent (breaks `npm test`)",
  )
  console.log(
    "    2. security:  archiveOrder() shell-injects orderId into execSync(`tar …`)",
  )
  console.log(
    "  then: run the loop → expect a review flagging both, never a merge.",
  )
}

async function killLoopBoxes(repo: string): Promise<void> {
  const boxes = await Sandbox.list({
    metadata: { loop: "pr-loop", repo },
  })
  for (const b of boxes) await Sandbox.killById(b.id)
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))

  if (flags.dryRun) {
    printPlan(
      flags.owner ?? "<owner>",
      flags.repoName ?? "superserve-loops-e2e-<ts>",
    )
    return
  }

  if (!process.env.SUPERSERVE_API_KEY) throw new Error("set SUPERSERVE_API_KEY")
  const auth = resolveAuth(process.env) // validates Claude + GitHub creds, throws if missing
  const ghEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  }
  if (!run("gh", ["--version"], { capture: true }))
    throw new Error("the `gh` CLI is required locally")

  const owner =
    flags.owner ??
    run("gh", ["api", "user", "--jq", ".login"], { env: ghEnv, capture: true })
  const repoName =
    flags.repoName ??
    `superserve-loops-e2e-${process.hrtime.bigint().toString().slice(-8)}`
  const repo = `${owner}/${repoName}`
  const work = mkdtempSync(join(tmpdir(), "ss-loops-e2e-"))
  const started = performance.now()

  console.log(`\n[1] creating throwaway repo ${repo} + baseline ...`)
  seed(work)
  run("git", ["init", "-q", "-b", "main"], { cwd: work })
  run("git", ["add", "-A"], { cwd: work })
  run(
    "git",
    [
      "-c",
      "user.name=loop-e2e",
      "-c",
      "user.email=e2e@superserve.ai",
      "commit",
      "-qm",
      "baseline",
    ],
    { cwd: work },
  )
  run(
    "gh",
    [
      "repo",
      "create",
      repo,
      "--private",
      "--source=.",
      "--remote=origin",
      "--push",
    ],
    { cwd: work, env: ghEnv },
  )

  console.log("[2] opening a PR with a planted logic bug + shell injection ...")
  run("git", ["checkout", "-q", "-b", "fix/discount"], { cwd: work })
  writeFileSync(join(work, "src/discount.js"), BUGGY_DISCOUNT)
  run("git", ["commit", "-aqm", "feat: tweak discount, add order archive"], {
    cwd: work,
    env: {
      ...ghEnv,
      GIT_AUTHOR_NAME: "loop-e2e",
      GIT_AUTHOR_EMAIL: "e2e@superserve.ai",
      GIT_COMMITTER_NAME: "loop-e2e",
      GIT_COMMITTER_EMAIL: "e2e@superserve.ai",
    },
  })
  run("git", ["push", "-q", "-u", "origin", "fix/discount"], {
    cwd: work,
    env: ghEnv,
  })
  const prUrl = run(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      repo,
      "--base",
      "main",
      "--head",
      "fix/discount",
      "--title",
      "Tweak discount + add order archive",
      "--body",
      "Adjusts the discount calc and adds an order-archive helper.",
    ],
    { env: ghEnv, capture: true },
  )
  const prNumber = prUrl.split("/").pop() ?? "1"
  console.log(`    opened ${prUrl}`)

  console.log(
    "[3] running the loop (cold start → Claude Code reviews the PR) ...",
  )
  const skill = readFileSync(
    new URL("../pr-loop/skill/SKILL.md", import.meta.url),
    "utf8",
  )
  const result = await runLoop(
    buildSpec({ repo, skill, auth }),
    undefined,
    (l) => process.stdout.write(l),
  )
  console.log(
    `\n    tick done — sandbox ${result.sandboxId}, exit ${result.exitCode}, ${SECS(performance.now() - started)}s total`,
  )

  console.log("[4] fetching the review the loop posted ...")
  const raw = run(
    "gh",
    ["pr", "view", prNumber, "--repo", repo, "--json", "reviews,comments"],
    { env: ghEnv, capture: true },
  )
  const parsed = JSON.parse(raw) as {
    reviews: Array<{ body: string; author: { login: string } }>
    comments: Array<{ body: string; author: { login: string } }>
  }
  const bodies = [...parsed.reviews, ...parsed.comments]
    .map((x) => x.body)
    .filter((b) => b.trim().length > 0)
  const lastBody = bodies.length > 0 ? bodies[bodies.length - 1] : undefined
  const review = bodies.find((b) => b.includes("pr-loop")) ?? lastBody

  console.log("\n========== REVIEW ==========")
  console.log(review ?? "(no review/comment found — see the loop output above)")
  console.log("============================\n")

  if (review) {
    const lc = review.toLowerCase()
    const caughtBug = lc.includes("discount") || lc.includes("test")
    const caughtSec =
      lc.includes("inject") || lc.includes("execsync") || lc.includes("shell")
    console.log(
      `heuristic: logic-bug flagged=${caughtBug}  injection flagged=${caughtSec}`,
    )
    console.log(
      caughtBug && caughtSec
        ? "RESULT: PASS — both planted issues surfaced."
        : "RESULT: review posted; eyeball it above.",
    )
  } else {
    console.log("RESULT: no review posted — inspect the loop output.")
  }

  if (flags.keep) {
    console.log(
      `\nkept ${repo} (and its sandbox). Delete with: gh repo delete ${repo} --yes`,
    )
    return
  }
  console.log("\n[5] tearing down (sandbox + repo) ...")
  await killLoopBoxes(repo)
  try {
    run("gh", ["repo", "delete", repo, "--yes"], { env: ghEnv, capture: true })
    console.log("done — sandbox + repo removed.")
  } catch {
    // The gh token may lack `delete_repo` scope — leave the repo for inspection.
    console.log(
      `done — sandbox removed. Repo left for inspection: gh repo delete ${repo} --yes`,
    )
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
