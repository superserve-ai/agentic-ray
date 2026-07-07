import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { runLoop } from "../lib/run-loop"
import type { LoopSpec, RunResult } from "../lib/run-loop"

/**
 * PR Loop — orchestrator (runs on the CI runner, NOT in a sandbox).
 *
 * This script is pure scheduling + lifecycle: find this repo's warm sandbox,
 * run ONE Claude Code tick inside it, pause. All the actual PR work — discover,
 * triage, fix, verify, comment, escalate — happens inside the box, driven by the
 * `pr-loop` skill (see ./skill/SKILL.md). The box boots from the
 * `superserve/claude-code` template, so the `claude` CLI is already installed.
 *
 * Auth is the headless Claude subscription path: a `CLAUDE_CODE_OAUTH_TOKEN`
 * (from `claude setup-token`) bound as a Superserve secret, so the token is
 * swapped in at egress and never lives in the box.
 *
 * Event-driven: the shipped workflow passes `--pr <n>` from the `pull_request`
 * event so a tick reviews just the changed PR. With no `--pr` (manual dispatch or
 * a local run) it sweeps every open PR.
 *
 * The repo defaults to the current git checkout's `github.com` remote, so `--repo`
 * is optional when you run inside the repo you want reviewed.
 *
 *   bun run pr-loop/loop.ts --pr 42              # review PR #42 in the current repo
 *   bun run pr-loop/loop.ts                      # sweep all open PRs (one tick)
 *   bun run pr-loop/loop.ts --watch              # local dev: re-tick on an interval
 *   bun run pr-loop/loop.ts --dry-run            # no keys needed
 *   bun run pr-loop/loop.ts --repo owner/name    # or target another repo explicitly
 */

const TEMPLATE = "superserve/claude-code"
const REPO_DIR = "/home/user/repo"
const SKILL_UPLOAD_PATH = "/home/user/pr-loop.SKILL.md"

export type ClaudeMode = "subscription" | "metered"

export interface ResolvedAuth {
  /** Superserve secret bindings: `{ ENV_VAR: secretName }`. */
  secrets: Record<string, string>
  /** Raw env vars passed through (dev path — value lives in the box). */
  envVars: Record<string, string>
  /** Which Claude credential the box uses. Subscription unsets any stray
   *  `ANTHROPIC_API_KEY`; metered keeps it (it IS the credential). */
  claudeMode: ClaudeMode
}

/**
 * Resolve Claude + GitHub credentials into sandbox bindings. Prefers Superserve
 * secret NAMES (`SUPERSERVE_*_SECRET`) so the real value never enters the box;
 * falls back to raw tokens in env vars for local dev. Throws a helpful message
 * listing what's missing.
 */
export function resolveAuth(env: NodeJS.ProcessEnv): ResolvedAuth {
  const secrets: Record<string, string> = {}
  const envVars: Record<string, string> = {}
  const missing: string[] = []

  // Claude: subscription (OAuth token from `claude setup-token`) is the default;
  // a metered `ANTHROPIC_API_KEY` also works (handy for quick tests).
  let claudeMode: ClaudeMode = "subscription"
  if (env.SUPERSERVE_CLAUDE_SECRET) {
    secrets.CLAUDE_CODE_OAUTH_TOKEN = env.SUPERSERVE_CLAUDE_SECRET
  } else if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    envVars.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN
  } else if (env.SUPERSERVE_ANTHROPIC_SECRET) {
    secrets.ANTHROPIC_API_KEY = env.SUPERSERVE_ANTHROPIC_SECRET
    claudeMode = "metered"
  } else if (env.ANTHROPIC_API_KEY) {
    envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
    claudeMode = "metered"
  } else {
    missing.push(
      "Claude: set CLAUDE_CODE_OAUTH_TOKEN (subscription, from `claude setup-token`) " +
        "or ANTHROPIC_API_KEY (metered) — or a SUPERSERVE_CLAUDE_SECRET / SUPERSERVE_ANTHROPIC_SECRET secret name.",
    )
  }

  // `gh` exports GH_TOKEN; raw PATs are usually GITHUB_TOKEN. Accept either, to
  // match the installer CLI's credential resolution.
  const githubToken = env.GITHUB_TOKEN || env.GH_TOKEN
  if (env.SUPERSERVE_GITHUB_SECRET) {
    secrets.GITHUB_TOKEN = env.SUPERSERVE_GITHUB_SECRET
  } else if (githubToken) {
    envVars.GITHUB_TOKEN = githubToken
  } else {
    missing.push(
      "GitHub: set SUPERSERVE_GITHUB_SECRET (name of a Superserve secret) or GITHUB_TOKEN / GH_TOKEN (a raw PAT).",
    )
  }

  if (missing.length > 0) {
    throw new Error(`Missing credentials:\n  - ${missing.join("\n  - ")}`)
  }
  return { secrets, envVars, claudeMode }
}

/** One-time bootstrap: install `gh` (root-free), place the skill, clone the repo. */
function setupScript(): string {
  return [
    "set -e",
    'export PATH="$HOME/.local/bin:$PATH"',
    "# The claude-code template ships `claude` but not `gh` — install it once (no root needed).",
    "if ! command -v gh >/dev/null 2>&1; then",
    "  GH_VERSION=2.63.2",
    '  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tgz',
    '  mkdir -p "$HOME/.local/bin"',
    "  tar -xzf /tmp/gh.tgz -C /tmp",
    '  cp "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" "$HOME/.local/bin/gh"',
    "fi",
    "# Make the pr-loop skill discoverable by Claude Code.",
    'mkdir -p "$HOME/.claude/skills/pr-loop"',
    `cp ${SKILL_UPLOAD_PATH} "$HOME/.claude/skills/pr-loop/SKILL.md"`,
    "# Authenticate git to github.com via the bound GITHUB_TOKEN. A credential",
    "# helper reads it at call time, so the token never lands in .gitconfig (works",
    "# for a raw PAT and for a Superserve proxy token swapped at egress). `gh` API",
    "# calls authenticate separately from the GITHUB_TOKEN env var.",
    'git config --global user.name "loop-engineering[bot]"',
    'git config --global user.email "loops@superserve.ai"',
    "git config --global credential.helper '!f() { echo username=x-access-token; echo \"password=$GITHUB_TOKEN\"; }; f'",
    "# Clone the target repo ONCE. Every later tick resumes this warm checkout.",
    `git clone "https://github.com/$TARGET_REPO" ${REPO_DIR}`,
  ].join("\n")
}

/** Per-tick: refresh the warm checkout, run Claude Code headlessly on the skill.
 *  With a `pr` number the tick reviews just that PR; without one it sweeps every
 *  open PR. `pr` is a validated integer (see `parsePrFlag`), so interpolating it
 *  into the prompt cannot inject shell. */
function iterateScript(claudeMode: ClaudeMode, pr?: number): string {
  const task = pr
    ? `Review pull request #${pr} in $TARGET_REPO.`
    : "Review the open PRs in $TARGET_REPO."
  return [
    // Fail the tick if the cd/fetch/refresh fail, instead of reviewing against a
    // stale or wrong-directory checkout.
    "set -e",
    // Subscription billing: drop any stray metered key so the OAuth token wins.
    // Metered mode keeps ANTHROPIC_API_KEY — it IS the credential.
    ...(claudeMode === "subscription"
      ? ["unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN"]
      : []),
    'export PATH="$HOME/.local/bin:$PATH"',
    `cd ${REPO_DIR}`,
    // Refresh the warm checkout every tick. `git fetch` alone only updates the
    // remote-tracking refs (origin/*): the default-branch working tree — where the
    // reviewer reads project context (CLAUDE.md/AGENTS.md, test & lint commands) —
    // would otherwise stay pinned at the clone-time SHA and go stale as the default
    // branch moves. So fetch, then hard-reset that checkout to the remote tip.
    "git fetch --all --prune --quiet",
    // Re-derive the default branch (guards a rename since clone); fall back to main.
    // Best-effort — the lookup itself must never fail the tick.
    "git remote set-head origin --auto >/dev/null 2>&1 || true",
    `DEFAULT_BRANCH="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"`,
    `DEFAULT_BRANCH="\${DEFAULT_BRANCH:-main}"`,
    // Each PR is reviewed in its own scratch worktree, so the main tree stays on the
    // default branch: `-f -B` fast-forwards it to origin and drops any stray change,
    // while leaving the untracked .pr-loop-state.md (loop memory) untouched.
    'git checkout -f -q -B "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH"',
    `claude -p "/pr-loop ${task}" \\`,
    "  --permission-mode dontAsk \\",
    // Allow gh/git + the common test runners so the verifier can actually run the
    // project's checks inside the microVM (safe — it's an isolated box).
    '  --allowedTools "Bash(gh *),Bash(git *),Bash(npm *),Bash(npx *),Bash(node *),Bash(bun *),Bash(pnpm *),Bash(yarn *),Bash(make *),Bash(pytest *),Bash(python3 *),Bash(go *),Bash(cargo *),Read,Edit,Write,Glob,Grep" \\',
    // Hard-block the dangerous ops at the tool layer, beyond the skill's rules.
    '  --disallowedTools "Bash(gh pr merge*),Bash(git push*)" \\',
    "  --output-format json \\",
    "  --max-turns 50",
  ].join("\n")
}

/** Build the loop spec for a repo. Pure — easy to unit-test. */
export function buildSpec(config: {
  repo: string
  skill: string
  auth: ResolvedAuth
  /** Focus the tick on one PR (from the `pull_request` event). Omit to sweep all. */
  pr?: number
}): LoopSpec {
  return {
    name: "pr-loop",
    // Keyed by repo only (not PR) on purpose: one warm box reviews the whole
    // repo, and the concurrency group serializes each PR's events onto it.
    metadata: { loop: "pr-loop", repo: config.repo },
    template: TEMPLATE,
    secrets: config.auth.secrets,
    envVars: { ...config.auth.envVars, TARGET_REPO: config.repo },
    uploads: { [SKILL_UPLOAD_PATH]: config.skill },
    setup: setupScript(),
    iterate: iterateScript(config.auth.claudeMode, config.pr),
    pauseWhenDone: true,
  }
}

// --- CLI ------------------------------------------------------------------

function getFlag(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1]
  return undefined
}

function parseDuration(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs
  const m = /^(\d+)(s|m|h)?$/.exec(value.trim())
  if (!m) return fallbackMs
  const n = Number(m[1])
  const unit = m[2] ?? "m"
  return n * (unit === "s" ? 1_000 : unit === "h" ? 3_600_000 : 60_000)
}

/**
 * The PR number to focus this tick on, or `undefined` to sweep all open PRs.
 * Digits-only so a hostile `--pr` value can't inject into the shell prompt built
 * in `iterateScript`. Empty (manual `workflow_dispatch` passes `--pr ""`) or
 * absent → `undefined` → sweep.
 */
export function parsePrFlag(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return n > 0 ? n : undefined
}

/**
 * Parse `owner/name` from a git remote URL (https or ssh, with or without a
 * `.git` suffix or trailing slash), or undefined if it isn't a github.com remote.
 */
export function parseRepoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  const m = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : undefined
}

/** `owner/name` from the current checkout's `origin` remote, so running inside
 *  the target repo needs no `--repo`. Undefined outside a git repo / no remote. */
function detectRepoFromGit(): string | undefined {
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return parseRepoUrl(url)
  } catch {
    return undefined
  }
}

function printDryRun(spec: LoopSpec): void {
  const redactedEnv = Object.fromEntries(
    Object.keys(spec.envVars ?? {}).map((k) => [
      k,
      k === "TARGET_REPO" ? spec.envVars?.[k] : "<provided>",
    ]),
  )
  console.log("[pr-loop] dry run — resolved loop spec (no sandbox created):\n")
  console.log(`  template:  ${spec.template}`)
  console.log(`  metadata:  ${JSON.stringify(spec.metadata)}`)
  console.log(
    `  secrets:   ${JSON.stringify(spec.secrets)}   (ENV_VAR -> Superserve secret name)`,
  )
  console.log(`  envVars:   ${JSON.stringify(redactedEnv)}`)
  console.log(`  uploads:   ${Object.keys(spec.uploads ?? {}).join(", ")}`)
  console.log(`\n  --- setup (runs once) ---\n${spec.setup}`)
  console.log(`\n  --- iterate (runs every tick) ---\n${spec.iterate}`)
}

/**
 * Run ONE tick: drive the loop spine once, log the outcome, and return the
 * iterate exit code. Returning the code (rather than swallowing it) lets the
 * one-shot caller surface a failed tick as a non-zero process exit — without
 * that, a broken `--once` run still resolves and the GitHub Action step exits 0,
 * so a failing tick looks operationally healthy. `run`/`log` are injected so
 * this stays unit-testable; the defaults are the real spine and console.
 */
export async function runTick(
  spec: LoopSpec,
  run: (spec: LoopSpec) => Promise<RunResult> = runLoop,
  log: (message: string) => void = (message) => {
    console.log(message)
  },
): Promise<number> {
  const result = await run(spec)
  const mode = result.bootstrapped ? "cold start (bootstrapped)" : "warm resume"
  log(
    `\n[pr-loop] tick done — sandbox ${result.sandboxId}, ${mode}, exit ${result.exitCode}`,
  )
  return result.exitCode
}

/**
 * Run the loop from an explicit argv. Exported so the package's `superserve-loops
 * run pr-loop …` verb (see ../install/cli.ts) drives the exact same code path
 * the CI workflow does via `bunx @superserve/loops run pr-loop`, without a
 * vendored copy. The `import.meta.main` guard below passes `process.argv.slice(2)`
 * so the local `bun run pr-loop/loop.ts …` dev path is unchanged.
 */
export async function runLoopCli(argv: string[]): Promise<void> {
  const args = argv
  const dryRun = args.includes("--dry-run")
  const watch = args.some((a) => a === "--watch" || a.startsWith("--watch="))

  const repo =
    getFlag(args, "--repo") ?? process.env.REPO ?? detectRepoFromGit()
  if (!repo) {
    console.error(
      "error: no repo given and none detected. Run inside a repo with a " +
        "github.com remote, or pass --repo owner/name (or set REPO).",
    )
    process.exit(1)
  }

  const skill = readFileSync(
    new URL("./skill/SKILL.md", import.meta.url),
    "utf8",
  )

  let auth: ResolvedAuth
  try {
    auth = resolveAuth(process.env)
  } catch (err) {
    if (!dryRun) {
      console.error(`error: ${(err as Error).message}`)
      process.exit(1)
    }
    auth = { secrets: {}, envVars: {}, claudeMode: "subscription" }
  }

  const pr = parsePrFlag(getFlag(args, "--pr"))
  const spec = buildSpec({ repo, skill, auth, pr })

  if (dryRun) {
    printDryRun(spec)
    return
  }

  const scope = pr ? `PR #${pr}` : "all open PRs"

  if (!watch) {
    console.log(`[pr-loop] reviewing ${scope} in ${repo}`)
    // One-shot (the `--once` GitHub Action path): surface a failed iterate as a
    // non-zero process exit so a scheduled run shows red instead of silently
    // green. Prefer process.exitCode over throwing — a throw reaches the
    // main().catch() below, which exits 1 and *loses* the real code (and dumps a
    // stack trace for an expected failure).
    const code = await runTick(spec)
    if (code !== 0) process.exitCode = code
    return
  }

  const intervalMs = parseDuration(getFlag(args, "--watch"), 15 * 60_000)
  console.log(
    `[pr-loop] watching ${repo} every ${intervalMs / 1000}s — Ctrl-C to stop`,
  )
  // Recursive setTimeout, NOT setInterval: schedule the next tick only after the
  // current one settles. Ticks share one persistent box, so an overlapping run
  // (a slow tick outlasting the interval) would race on the same git checkout.
  //
  // Watch mode logs-and-continues: one bad tick must not kill a long-running
  // watcher, so the exit code is intentionally ignored here (the .catch below
  // handles a thrown tick). Only the one-shot path above maps it to the exit.
  const logTickFailure = (err: unknown): void =>
    console.error(`[pr-loop] tick failed: ${err}`)
  const scheduleNext = (): void => {
    setTimeout(() => {
      void runTick(spec).catch(logTickFailure).finally(scheduleNext)
    }, intervalMs)
  }
  // The first tick gets the same treatment as every scheduled one — otherwise a
  // transient failure here throws past this function and kills the watcher
  // before it ever schedules a retry.
  await runTick(spec).catch(logTickFailure)
  scheduleNext()
}

// Only run when executed directly (so tests can import buildSpec/resolveAuth).
if ((import.meta as { main?: boolean }).main) {
  void runLoopCli(process.argv.slice(2)).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
