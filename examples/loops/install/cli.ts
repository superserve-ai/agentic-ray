#!/usr/bin/env bun
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { Secret } from "@superserve/sdk"

import { assertTokenScope, runLoopCli } from "../pr-loop/loop"

/**
 * `superserve-loops add pr-loop` — one-command install of a loop into the
 * current repo. Creates the Superserve secrets, writes the GitHub Actions
 * workflow, and sets the `SUPERSERVE_API_KEY` repo secret.
 *
 *   bunx @superserve/loops add pr-loop            # interactive
 *   SUPERSERVE_API_KEY=… CLAUDE_CODE_OAUTH_TOKEN=… GITHUB_TOKEN=… \
 *     bunx @superserve/loops add pr-loop --yes    # non-interactive
 *
 * The workflow it writes does NOT vendor any loop source into the repo — it runs
 * the published package (`bunx @superserve/loops run pr-loop …`), so the only
 * thing that touches the repo is one workflow file. `run` is the CI-facing verb the
 * workflow invokes; it drives ../pr-loop/loop.ts from inside the package.
 *
 * Tokens you provide are turned into Superserve secrets (swapped in at egress,
 * never committed, never seen by the box). The workflow file is committed and
 * pushed for you — without that push, GitHub never sees the workflow and the
 * loop never runs — plus the encrypted `SUPERSERVE_API_KEY` Actions secret.
 */

// The workflow pins a Superserve-gated dist-tag, NOT a semver range or `@latest`:
// `@stable` moves only when the release pipeline promotes it (see loops-publish.yml),
// so installed workflows auto-get blessed updates and can be rolled back centrally —
// the user never edits the committed file again.
const PACKAGE_SPEC = "@superserve/loops@stable"
const CLAUDE_SECRET = "claude-oauth"
const GITHUB_SECRET = "loop-github-token"
// GitHub App identity mode: the workflow mints a short-lived installation token
// from these two GitHub Actions secrets. Referenced by name so they resolve from
// either repo OR org secrets — set them once org-wide and every repo inherits them.
const APP_ID_SECRET = "LOOP_APP_ID"
const APP_KEY_SECRET = "LOOP_APP_PRIVATE_KEY"

const c = {
  ok: (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`),
  warn: (s: string) => console.log(`  \x1b[33m!\x1b[0m ${s}`),
  step: (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`),
  info: (s: string) => console.log(`    ${s}`),
}

function fail(message: string): never {
  console.error(`\x1b[31merror:\x1b[0m ${message}`)
  process.exit(1)
}

// --- small shell helpers ---------------------------------------------------

function tryExec(file: string, args: string[]): string | undefined {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return undefined
  }
}

function detectRepo(flag: string | undefined): string {
  if (flag) return flag
  const url = tryExec("git", ["config", "--get", "remote.origin.url"])
  const m = url
    ? /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/.exec(url)
    : null
  if (!m) {
    fail(
      "could not detect the GitHub repo. Pass --repo owner/name (run inside a repo with a github.com remote).",
    )
  }
  return `${m[1]}/${m[2]}`
}

/** Read a secret from the terminal without echoing it. */
function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process
    if (!stdin.isTTY)
      fail(`missing credential and no TTY to prompt. ${query.trim()}`)
    stdout.write(query)
    stdin.setRawMode(true)
    stdin.resume()
    let buf = ""
    // Fail fast if stdin dies mid-prompt (pipe break, SSH drop) — without this
    // the promise never settles and the installer hangs indefinitely. Removed
    // together with the data listener once the prompt settles, so a later stdin
    // hiccup can't kill the install halfway through the secret-rotation /
    // commit / push steps that follow.
    const onError = (): void => fail("stdin closed while waiting for input")
    const detach = (): void => {
      stdin.setRawMode(false)
      stdin.off("data", onData)
      stdin.off("error", onError)
    }
    const onData = (d: Buffer): void => {
      const ch = d.toString("utf8")
      const code = ch.charCodeAt(0)
      if (code === 13 || code === 10 || code === 4) {
        // Enter / Ctrl-D — submit
        detach()
        stdin.pause()
        stdout.write("\n")
        resolve(buf.trim())
      } else if (code === 3) {
        // Ctrl-C — abort
        detach()
        process.exit(1)
      } else if (code === 127 || code === 8) {
        // Backspace
        buf = buf.slice(0, -1)
      } else {
        buf += ch
      }
    }
    stdin.on("data", onData)
    stdin.once("error", onError)
  })
}

interface Flags {
  repo?: string
  apiKey?: string
  claudeToken?: string
  githubToken?: string
  githubApp: boolean
  dryRun: boolean
  yes: boolean
}

function parseFlags(args: string[]): Flags {
  const get = (name: string): string | undefined => {
    const eq = args.find((a) => a.startsWith(`${name}=`))
    if (eq) return eq.slice(name.length + 1)
    const i = args.indexOf(name)
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")
      ? args[i + 1]
      : undefined
  }
  return {
    repo: get("--repo"),
    apiKey: get("--api-key"),
    claudeToken: get("--claude-token"),
    githubToken: get("--github-token"),
    githubApp: args.includes("--github-app"),
    dryRun: args.includes("--dry-run"),
    yes: args.includes("--yes"),
  }
}

async function resolveCred(opts: {
  label: string
  envNames: string[]
  flag: string | undefined
  fallback?: () => string | undefined
  yes: boolean
  hint: string
}): Promise<string> {
  if (opts.flag) return opts.flag
  for (const name of opts.envNames) {
    const v = process.env[name]
    if (v) return v
  }
  const fb = opts.fallback?.()
  if (fb) return fb
  if (opts.yes) {
    fail(
      `missing ${opts.label}. Set one of ${opts.envNames.join(" / ")} or pass the flag. ${opts.hint}`,
    )
  }
  return promptHidden(`  ${opts.label}: `)
}

/** Pull the `sk-ant-oat01-…` token out of `claude setup-token` output. */
export function extractOAuthToken(output: string): string | undefined {
  return /sk-ant-oat01-[A-Za-z0-9_-]+/.exec(output)?.[0]
}

/**
 * Run `claude setup-token` interactively and capture the long-lived token it
 * prints. stdin + stderr are inherited so the browser sign-in / any prompts work
 * normally; stdout is captured AND echoed (tee) so the user still sees the flow.
 * Resolves undefined if `claude` can't run or prints no token (caller falls back
 * to a manual paste).
 */
function runClaudeSetupToken(): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = ""
    const child = spawn("claude", ["setup-token"], {
      stdio: ["inherit", "pipe", "inherit"],
    })
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      out += text
      process.stdout.write(text)
    })
    child.on("error", () => resolve(undefined))
    child.on("close", () => resolve(extractOAuthToken(out)))
  })
}

/**
 * Resolve the loop's Claude credential. Order: explicit --claude-token, then
 * CLAUDE_CODE_OAUTH_TOKEN, then — interactively, when `claude` is installed — run
 * `claude setup-token` FOR the user and capture its output, and finally fall back
 * to a manual paste. `claude setup-token` (not the local session login) is
 * required because the loop needs a ~1-year token that won't expire mid-run.
 */
async function resolveClaudeToken(flags: Flags): Promise<string> {
  if (flags.claudeToken) return flags.claudeToken
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
    return process.env.CLAUDE_CODE_OAUTH_TOKEN

  if (!flags.yes && process.stdout.isTTY && tryExec("claude", ["--version"])) {
    c.info(
      "No Claude token set — running `claude setup-token` for you (opens your browser to sign in)…",
    )
    const token = await runClaudeSetupToken()
    if (token) {
      c.ok("captured a long-lived Claude subscription token")
      return token
    }
    c.warn(
      "couldn't auto-capture the token — paste it below (from the `claude setup-token` output).",
    )
  }

  return resolveCred({
    label: "Claude subscription token",
    envNames: ["CLAUDE_CODE_OAUTH_TOKEN"],
    flag: undefined,
    yes: flags.yes,
    hint: "Generate it with `claude setup-token` (needs a Pro/Max/Team/Enterprise plan).",
  })
}

// --- steps -----------------------------------------------------------------

async function upsertSecret(
  name: string,
  value: string,
  create: () => Promise<Secret>,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    c.ok(`would create/rotate Superserve secret "${name}"`)
    return
  }
  const existing = await Secret.list()
  if (existing.some((s) => s.name === name)) {
    const secret = await Secret.get(name)
    await secret.rotate(value)
    c.ok(`rotated existing Superserve secret "${name}"`)
  } else {
    await create()
    c.ok(`created Superserve secret "${name}"`)
  }
}

/**
 * The GitHub Actions workflow, as a string. Event-driven: it runs on every PR
 * code change (a commit pushed to a PR), not on a clock.
 *
 * Default (no `githubSecret`): the loop posts as `github-actions[bot]` using the
 * workflow's built-in `GITHUB_TOKEN` — no PAT to create, nothing extra to store.
 * This is the fast path, and it works because the workflow reviews the SAME repo it
 * lives in (`--repo "${{ github.repository }}"`), which that token already covers.
 *
 * Pass `githubSecret` for the cross-repo / custom-identity fallback: the loop then
 * authenticates with a GitHub PAT stored under that Superserve secret name instead
 * (swapped in at egress), so it can reach other repos or post under a branded account.
 *
 * Pass `githubApp: true` for the branded-bot path: the workflow mints a short-lived
 * installation token from a user-supplied GitHub App (`LOOP_APP_ID` /
 * `LOOP_APP_PRIVATE_KEY` secrets), so reviews post as that App — its own name and
 * avatar. This is the recommended identity for a fleet: the App is installed once
 * (org-wide or on selected repos), the two secrets live at the org level, and every
 * repo's install inherits them with no per-repo token handling.
 */
export function buildWorkflow(
  opts: { githubSecret?: string; githubApp?: boolean } = {},
): string {
  // GitHub App mode needs an extra step: mint the installation token before the run
  // so its output is available as GITHUB_TOKEN. The other two modes need no step.
  const tokenStep = opts.githubApp
    ? `      # Mint a short-lived installation token so reviews post as YOUR GitHub App
      # (its name + avatar). ${APP_ID_SECRET} / ${APP_KEY_SECRET} resolve from repo OR
      # org secrets — set them once org-wide and every repo inherits them.
      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: \${{ secrets.${APP_ID_SECRET} }}
          private-key: \${{ secrets.${APP_KEY_SECRET} }}
`
    : ""
  const githubAuth = opts.githubApp
    ? `          # Posts as your GitHub App via the installation token minted above.
          GITHUB_TOKEN: \${{ steps.app-token.outputs.token }}`
    : opts.githubSecret
      ? `          # Cross-repo / custom bot identity: authenticate with a PAT stored as a Superserve secret.
          SUPERSERVE_GITHUB_SECRET: ${opts.githubSecret}`
      : `          # Reviews post as github-actions[bot] via the workflow's built-in token.
          GITHUB_TOKEN: \${{ github.token }}`
  return `# Installed by \`superserve-loops add pr-loop\`. Runs on every PR code change
# (a commit pushed to a PR) — no idle cron. One warm-sandbox tick per event, then it sleeps.
# Note: \`pull_request\` from a forked repo gets a read-only token, so reviews on fork PRs need
# the cross-repo PAT path (see below) or \`pull_request_target\` (the loop runs PR code only in
# the sandbox, never on the runner). Add \`schedule:\` back if you also want a safety-net sweep.
name: loop-pr-loop
on:
  pull_request:
    types: [opened, synchronize, reopened] # synchronize = new commits pushed to the PR
  workflow_dispatch: {}
concurrency:
  # Serialize per repo: all PR reviews share one warm sandbox, so don't run two at once.
  group: loop-pr-loop
  cancel-in-progress: false
# Least privilege: clone the repo + post the review and ready-to-merge / needs-human labels.
permissions:
  contents: read
  pull-requests: write
jobs:
  tick:
    # Fork PRs can't read repo secrets or write with the built-in token — skip them.
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
${tokenStep}      - uses: oven-sh/setup-bun@v2
      # Runs the PUBLISHED loop — no loop source is vendored into this repo, and no repo
      # checkout is needed (the sandbox clones the target repo itself). \`@stable\` is a
      # Superserve-gated channel, so blessed updates roll out here without editing this file.
      # --pr focuses the tick on the changed PR; empty on manual dispatch → sweep all.
      - run: bunx ${PACKAGE_SPEC} run pr-loop --repo "\${{ github.repository }}" --pr "\${{ github.event.pull_request.number }}" --once
        env:
          SUPERSERVE_API_KEY: \${{ secrets.SUPERSERVE_API_KEY }}
          SUPERSERVE_CLAUDE_SECRET: ${CLAUDE_SECRET}
${githubAuth}
`
}

function writeWorkflow(
  repoRoot: string,
  opts: { githubSecret?: string; githubApp?: boolean },
  dryRun: boolean,
): string {
  const path = join(repoRoot, ".github", "workflows", "loop-pr-loop.yml")
  if (dryRun) {
    c.ok(`would write ${path}`)
    return path
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buildWorkflow(opts))
  c.ok(`wrote ${path}`)
  return path
}

/**
 * True when both GitHub App secrets are already visible to the repo (repo- or
 * org-level). Pushing the App-mode workflow before they exist ships a live,
 * immediately-red workflow: its very first `pull_request` event fails at the
 * token-mint step. Fail closed — any lookup error (no `gh`, no access, not an
 * org repo) counts as "not configured".
 */
function appSecretsConfigured(
  repo: string,
  ghToken: string | undefined,
): boolean {
  const env = ghToken ? { ...process.env, GH_TOKEN: ghToken } : process.env
  const names = new Set<string>()
  const endpoints = [
    `repos/${repo}/actions/secrets`, // repo-level
    `repos/${repo}/actions/organization-secrets`, // org-level, visible to this repo
  ]
  for (const endpoint of endpoints) {
    try {
      const out = execFileSync(
        "gh",
        ["api", endpoint, "--jq", ".secrets[].name"],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] },
      )
      for (const name of out.split("\n")) names.add(name.trim())
    } catch {
      // 404 (user-owned repo has no org secrets) or no gh/access — treat as unset.
    }
  }
  return names.has(APP_ID_SECRET) && names.has(APP_KEY_SECRET)
}

/**
 * Commit and push the workflow file. Without this, the file only exists in the
 * local working tree — GitHub never sees it, no run is registered, and the loop
 * silently never fires. Falls back to printing the manual commands on any
 * failure (no repo write access, nothing to commit, no upstream configured, …).
 * With `push: false` (App mode before its secrets exist) it commits but leaves
 * publishing to the user, so a half-configured workflow never goes live.
 */
function commitAndPushWorkflow(
  repoRoot: string,
  path: string,
  dryRun: boolean,
  push = true,
): void {
  const rel = relative(repoRoot, path)
  if (dryRun) {
    c.ok(`would commit and push ${rel}`)
    return
  }
  const manualFallback = (): void => {
    c.info(
      `git add ${rel} && git commit -m 'Add pr-loop GitHub Actions workflow' && git push`,
    )
  }
  try {
    execFileSync("git", ["add", rel], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
    })
    execFileSync(
      "git",
      ["commit", "-m", "Add pr-loop GitHub Actions workflow"],
      { cwd: repoRoot, stdio: ["ignore", "ignore", "pipe"] },
    )
    c.ok(`committed ${rel}`)
  } catch (err) {
    c.warn(
      `could not commit automatically (${(err as Error).message.split("\n")[0]}).`,
    )
    manualFallback()
    return
  }
  if (!push) {
    c.warn(
      "NOT pushed yet — the workflow references GitHub App secrets that aren't set.",
    )
    c.info("Set them (instructions below), then publish with: git push")
    return
  }
  try {
    execFileSync("git", ["push"], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
    })
    c.ok("pushed to remote")
  } catch (err) {
    c.warn(
      `could not push automatically (${(err as Error).message.split("\n")[0]}).`,
    )
    c.info("git push")
  }
}

function setActionsSecret(
  repo: string,
  apiKey: string,
  ghToken: string | undefined,
  dryRun: boolean,
): void {
  if (dryRun) {
    c.ok(`would set GitHub Actions secret SUPERSERVE_API_KEY on ${repo}`)
    return
  }
  if (!tryExec("gh", ["--version"])) {
    c.warn("gh CLI not found — set the Actions secret manually:")
    c.info(
      `echo '<your SUPERSERVE_API_KEY>' | gh secret set SUPERSERVE_API_KEY --repo ${repo}`,
    )
    return
  }
  try {
    // Value comes via stdin so it never lands on the process argv list. Auth uses an
    // explicit token when given, else the user's ambient `gh` login — this is a one-time
    // local/CI action to store the secret, NOT the bot identity (that's the workflow token).
    execFileSync(
      "gh",
      ["secret", "set", "SUPERSERVE_API_KEY", "--repo", repo],
      {
        input: apiKey,
        env: ghToken ? { ...process.env, GH_TOKEN: ghToken } : process.env,
        stdio: ["pipe", "ignore", "pipe"],
      },
    )
    c.ok(`set GitHub Actions secret SUPERSERVE_API_KEY on ${repo}`)
  } catch (err) {
    c.warn(
      `could not set the Actions secret automatically (${(err as Error).message.split("\n")[0]}).`,
    )
    c.info(
      `echo '<your SUPERSERVE_API_KEY>' | gh secret set SUPERSERVE_API_KEY --repo ${repo}`,
    )
  }
}

// --- main ------------------------------------------------------------------

const HELP = `superserve-loops — install agent loops into a repo

Usage:
  superserve-loops add pr-loop [options]
  superserve-loops run pr-loop [--repo owner/name] [--pr N] [--once]
                                    (CI-facing — the installed workflow invokes this)

Options:
  --repo owner/name      Target repo (default: detected from the git remote)
  --api-key <key>        Superserve API key (or env SUPERSERVE_API_KEY)
  --claude-token <tok>   Claude subscription token from \`claude setup-token\` (or env CLAUDE_CODE_OAUTH_TOKEN)
  --github-token <tok>   GitHub PAT for cross-repo reviews or a custom bot identity
                         (optional — by default reviews post as github-actions[bot])
  --github-app           Post reviews as your own GitHub App (its name + avatar). The
                         workflow mints a per-run installation token from the
                         ${APP_ID_SECRET} / ${APP_KEY_SECRET} secrets (repo or org).
  --yes                  Non-interactive (fail instead of prompting)
  --dry-run              Show what would happen; change nothing
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP)
    return
  }
  const [command, loop] = argv
  if (command === "run") {
    // The CI-facing verb the generated workflow invokes (`bunx @superserve/loops run
    // pr-loop …`). Drive the loop from inside the published package — everything
    // after `run pr-loop` is the loop's own argv (--repo, --pr, --once, …).
    if (loop !== "pr-loop") {
      fail(`unknown loop "${loop ?? ""}". Available: pr-loop`)
    }
    await runLoopCli(argv.slice(2))
    return
  }
  if (command !== "add") {
    fail(
      `unknown command "${command}". Try: superserve-loops add pr-loop (or: run pr-loop …)`,
    )
  }
  if (loop !== "pr-loop") {
    fail(`unknown loop "${loop ?? ""}". Available: pr-loop`)
  }

  const flags = parseFlags(argv)
  const repo = detectRepo(flags.repo)
  const repoRoot =
    tryExec("git", ["rev-parse", "--show-toplevel"]) ?? process.cwd()

  console.log(
    `\nInstalling \x1b[1mpr-loop\x1b[0m into \x1b[1m${repo}\x1b[0m${flags.dryRun ? " (dry run)" : ""}\n`,
  )
  if (!flags.dryRun) {
    console.log(
      "Provide credentials (turned into Superserve secrets — never committed):",
    )
  }

  const apiKey = flags.dryRun
    ? (flags.apiKey ?? process.env.SUPERSERVE_API_KEY ?? "<api-key>")
    : await resolveCred({
        label: "Superserve API key",
        envNames: ["SUPERSERVE_API_KEY"],
        flag: flags.apiKey,
        yes: flags.yes,
        hint: "Get one at https://console.superserve.ai.",
      })
  const claudeToken = flags.dryRun
    ? "<claude-token>"
    : await resolveClaudeToken(flags)
  // GitHub identity is OPTIONAL. Default: the loop posts as github-actions[bot] using
  // the workflow's built-in token (no PAT). Pass --github-token to opt into a PAT
  // identity — needed to review a different repo or to post under a branded account.
  const patToken = flags.githubToken
  // Fail closed on write-capable classic PATs BEFORE storing anything: the loop's
  // "propose, never merge/push" guarantee is the token scope, and this is the last
  // point where the raw value is in hand (as a Superserve secret it never is again).
  if (patToken && !flags.dryRun) {
    await assertTokenScope(patToken).catch((err: unknown) => {
      fail((err as Error).message)
    })
  }
  // Auth for the one-time `gh secret set` below: the explicit PAT if given, else the
  // user's ambient `gh` login / CI token. This only stores SUPERSERVE_API_KEY — it is
  // NOT the bot identity (that's the workflow token at runtime).
  const ghAuthToken =
    patToken ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_TOKEN ??
    tryExec("gh", ["auth", "token"])

  c.step("1/3  Superserve secrets")
  process.env.SUPERSERVE_API_KEY = apiKey // used by the SDK for Secret.* calls
  await upsertSecret(
    CLAUDE_SECRET,
    claudeToken,
    () =>
      Secret.create({
        name: CLAUDE_SECRET,
        value: claudeToken,
        auth: { type: "bearer" },
        hosts: ["api.anthropic.com"],
      }),
    flags.dryRun,
  )
  if (flags.githubApp) {
    // App mode owns the identity — no Superserve secret; the workflow mints a
    // per-run installation token from the two GitHub Actions secrets instead.
    c.ok(
      "GitHub: reviews post as your GitHub App — the workflow mints its installation token",
    )
  } else if (patToken) {
    await upsertSecret(
      GITHUB_SECRET,
      patToken,
      () =>
        Secret.create({
          name: GITHUB_SECRET,
          value: patToken,
          provider: "github",
        }),
      flags.dryRun,
    )
  } else {
    c.ok(
      "GitHub: reviews post as github-actions[bot] (workflow token) — no secret needed",
    )
  }

  c.step("2/3  GitHub Actions workflow")
  const workflowPath = writeWorkflow(
    repoRoot,
    {
      githubApp: flags.githubApp,
      // PAT and App identity are mutually exclusive; App wins if both are given.
      githubSecret: !flags.githubApp && patToken ? GITHUB_SECRET : undefined,
    },
    flags.dryRun,
  )
  // App mode: only auto-push once LOOP_APP_ID / LOOP_APP_PRIVATE_KEY exist —
  // pushing earlier ships a workflow whose first pull_request event fails at
  // the token-mint step. The default and PAT paths are immune (their credential
  // exists at push time), so they always push.
  const appSecretsReady =
    !flags.githubApp || flags.dryRun || appSecretsConfigured(repo, ghAuthToken)
  commitAndPushWorkflow(repoRoot, workflowPath, flags.dryRun, appSecretsReady)

  c.step("3/3  GitHub Actions secret")
  setActionsSecret(repo, apiKey, ghAuthToken, flags.dryRun)

  c.step(flags.dryRun ? "Dry run complete — nothing changed." : "Done.")
  if (!flags.dryRun) {
    if (flags.githubApp) {
      c.info(
        `GitHub App identity needs two secrets (set once as REPO or ORG secrets):`,
      )
      c.info(
        `  gh secret set ${APP_ID_SECRET} --repo ${repo}            # the App's numeric ID`,
      )
      c.info(
        `  gh secret set ${APP_KEY_SECRET} --repo ${repo} < key.pem  # the App's .pem private key`,
      )
      c.info(
        "  Prefer ORG secrets (--org instead of --repo) so every future repo inherits them.",
      )
      if (!appSecretsReady) {
        c.info("Then publish the committed workflow: git push")
      }
    }
    if (appSecretsReady) {
      c.info(
        `gh workflow run loop-pr-loop.yml --repo ${repo}   # trigger the first run now`,
      )
    }
    c.info(
      flags.githubApp
        ? "Each new commit to a PR is reviewed within seconds — reviews post as your GitHub App."
        : patToken
          ? "Each new commit to a PR is reviewed within seconds (reviews post under your PAT identity)."
          : "Each new commit to a PR is reviewed within seconds — reviews post as github-actions[bot].",
    )
  }
}

if ((import.meta as { main?: boolean }).main) {
  void main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
