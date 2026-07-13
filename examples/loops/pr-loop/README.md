# PR Loop

Shepherd open pull requests toward merge — without a human watching them — by running
**Claude Code headless inside a warm Superserve sandbox** on a schedule.

Each tick the loop discovers open PRs, reviews every new commit against a calibrated rubric, runs
the project's own checks as a verifier, posts **one** concise signed review, and **escalates** risky
PRs to a human. It **proposes**; a human merges. It never merges, force-pushes, or edits CI.

![One PR Loop tick end to end: a pushed commit resumes the warm box, which reads context, reviews the diff, and runs the project's own tests as the verifier, then branches three ways — a clean PR gets a ready-to-merge label, a real bug gets a needs-author verdict, and a security or injection or stuck case escalates to a human. All three converge on updating state and pausing to near-zero idle. A hard-limits band notes it never merges, force-pushes, or edits CI](../assets/pr-loop-tick.png)

Everything is on this one page, from "just try it" to "a branded bot with your own skills":

**[Install](#install-into-a-repo-one-command)** · **[Run a tick locally](#run-a-tick-locally)** ·
**[Manual setup](#manual-setup-what-the-installer-automates)** · **[How it triggers](#how-it-triggers)** ·
**[Branded avatar](#give-it-a-branded-avatar)** · **[Personalize](#make-it-review-your-way)** ·
**[Run from source](#deeper-changes-run-from-source)** · **[Rotate / uninstall](#rotate-revoke-uninstall)** ·
**[Troubleshooting](#troubleshooting)** · **[Key reference](#which-key-does-what)**

## Why a sandbox (and not just a GitHub Action)

- **Warm checkout at high cadence.** A 15-min Action re-clones + re-installs every run. Here the
  repo + deps are cloned _once_ on first create; every later tick resumes warm (`setup` is skipped).
- **Isolation for untrusted code.** A PR diff is untrusted input. Claude Code reviews and runs it
  inside a Firecracker microVM with `git worktree` isolation — never on your host or CI runner.
- **~$0 idle.** The box is paused between ticks.

The brain is Claude Code, driven by the [`pr-loop` skill](./skill/SKILL.md) (review rubric
ported from [`reviewd`](https://github.com/simion/reviewd), MIT). State lives in the box at
`/home/user/repo/.pr-loop-state.md`, deduped by PR head SHA.

The mental model: the loop is a tiny **orchestrator** that drives that warm sandbox. "Running it" —
locally or in CI — only means running the orchestrator; the review always happens in the cloud
sandbox. So a real run always needs a Superserve API key + a Claude credential; only `--dry-run`
needs nothing.

## Prerequisites

| You need                             | Where to get it                                                                          | Notes                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Superserve API key** (`ss_live_…`) | [console.superserve.ai](https://console.superserve.ai)                                   | The account that runs the sandbox.                                                                                                                                                                     |
| **A Claude credential**              | `claude setup-token` (subscription, ~1-yr token) **or** an `ANTHROPIC_API_KEY` (metered) | Subscription keeps most ticks off the metered bill.                                                                                                                                                    |
| **bun**                              | [bun.sh](https://bun.sh)                                                                 | Only to run the installer / a local tick.                                                                                                                                                              |
| **GitHub access**                    | —                                                                                        | **Nothing extra** for reviewing the same repo the workflow lives in — it uses the built-in Actions token. A PAT or your own GitHub App is only for a _different_ repo or a _branded_ identity (below). |

## Install into a repo (one command)

```bash
# run inside the repo you want reviewed
bunx @superserve/loops add pr-loop
```

It detects the repo, prompts (without echo) for your Superserve API key, and — when `claude` is
installed — **runs `claude setup-token` for you** to mint the long-lived Claude token (otherwise it
prompts you to paste one). Then it does everything: creates the Superserve secret (`claude-oauth`,
egress-swapped — the token never enters the box), writes `.github/workflows/loop-pr-loop.yml`
(the _only_ file added to your repo), and sets the `SUPERSERVE_API_KEY` Actions secret.
The workflow runs the **published** `@superserve/loops` package (`bunx @superserve/loops@stable run
pr-loop …`), so **no loop source is vendored in**. It pins the `@stable` channel, so
improvements to the loop roll out automatically; you never edit the file again.
Reviews post as **`github-actions[bot]`** (the workflow's built-in token — no GitHub PAT needed).

The installer also commits the workflow file for you — pathspec-scoped to that one file, so
anything else you had staged stays staged — and pushes it only after a y/N confirmation
(`--yes` consents non-interactively). It refuses to auto-push if your branch already has
unpublished commits (the push must publish nothing but the installer's own commit); in that
case, and whenever it can't push, it prints the exact command:

```bash
git push
```

Push a commit to any PR and it reviews that PR within seconds — no idle cron.

Non-interactive and other flags:

```bash
# CI / non-interactive: pass tokens via env…
SUPERSERVE_API_KEY=… CLAUDE_CODE_OAUTH_TOKEN=… \
  bunx @superserve/loops add pr-loop --yes
# …or the same as flags:
bunx @superserve/loops add pr-loop --api-key ss_live_… --claude-token sk-ant-oat01-… --yes
# preview without changing anything
bunx @superserve/loops add pr-loop --dry-run
# review a DIFFERENT repo, or post under a machine-user identity → opt into a PAT
bunx @superserve/loops add pr-loop --github-token <PAT>
```

**PAT scopes** (only for the `--github-token` path): a fine-grained PAT on the target repo with
`Contents: Read`, `Pull requests: Read & write`, `Issues: Read & write`. Classic `repo`-scope
tokens are **refused** (fail closed at install and at each tick): `repo` grants push/merge on
every repo the account can reach, which voids the loop's "propose, never act" guarantee. Set
`LOOP_ALLOW_WRITE_TOKEN=1` only if you knowingly accept that risk.
To post under a custom _name_ without creating a GitHub App, make the PAT from a
dedicated [machine-user account](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts)
(e.g. `acme-review-bot`); reviews then post as that user. A GitHub App ([below](#give-it-a-branded-avatar))
additionally gets you the `[bot]` badge, an avatar, and short-lived per-repo tokens.

> In this monorepo (pre-publish), run it as `bun run examples/loops/install/cli.ts add pr-loop`.

## Run a tick locally

No commit, no repo changes — good for seeing the resolved plan and one live review first.
`--repo` is **optional**: it defaults to the current checkout's `github.com` remote, so run these
from inside the repo you want reviewed (or pass `--repo owner/name` to target another).

```bash
# Preview only — creates nothing, needs no keys:
bunx @superserve/loops run pr-loop --dry-run

# One real tick from your machine (the orchestrator runs here; the review runs in the
# cloud sandbox). Point at your Superserve secrets:
SUPERSERVE_API_KEY=ss_live_… \
SUPERSERVE_CLAUDE_SECRET=claude-oauth \
SUPERSERVE_GITHUB_SECRET=loop-github-token \
  bunx @superserve/loops run pr-loop --pr 42

# Local watch loop (dev): every 15 min
bunx @superserve/loops run pr-loop --watch=15m
```

- `--pr N` focuses one PR; omit it to sweep every open PR in one tick.
- For dev without Superserve secrets, pass raw tokens instead (they then live in the box for the
  run): `CLAUDE_CODE_OAUTH_TOKEN=… GITHUB_TOKEN=$(gh auth token) bunx @superserve/loops run pr-loop`.
  Swap `CLAUDE_CODE_OAUTH_TOKEN` for `ANTHROPIC_API_KEY` to use metered billing.
- In this monorepo: `bun run pr-loop/loop.ts …` runs the same CLI.

## Manual setup (what the installer automates)

1. **Generate a Claude subscription token** on a machine with a browser:
   ```bash
   claude setup-token        # requires a Pro/Max/Team/Enterprise plan; prints a ~1-year token
   ```
2. **Create one Superserve secret** (console → https://console.superserve.ai/secrets, or the SDK):
   ```ts
   import { Secret } from "@superserve/sdk"
   // The OAuth token is sent as `Authorization: Bearer` to Anthropic — bind it with a custom
   // auth config scoped to Anthropic's hosts so it's swapped in at egress and never seen by the box.
   await Secret.create({
     name: "claude-oauth",
     value: process.env.CLAUDE_CODE_OAUTH_TOKEN!,
     auth: { type: "bearer" }, // Authorization: Bearer <token>
     hosts: ["api.anthropic.com"],
   })
   ```
3. **Set `SUPERSERVE_API_KEY`** in your environment (and as a GitHub Actions secret for the workflow).

GitHub auth needs no setup: the workflow posts as **`github-actions[bot]`** via the built-in
`GITHUB_TOKEN`, so there's no PAT to create. **Cross-repo / branded identity** (review a different
repo, or post under your own bot account) is the opt-in fallback — create a GitHub PAT
([scopes above](#install-into-a-repo-one-command)) as a Superserve secret and point the workflow at it:

```ts
await Secret.create({
  name: "loop-github-token",
  value: process.env.GH_PAT!,
  provider: "github",
})
// then in the workflow, replace `GITHUB_TOKEN: ${{ github.token }}` with:
//   SUPERSERVE_GITHUB_SECRET: loop-github-token
```

## How it triggers

Copy [`workflow.yml`](./workflow.yml) into `.github/workflows/` of the repo you want reviewed — it
fires on `pull_request` (`opened`, `synchronize`, `reopened`), so it reviews a PR the moment a commit
is pushed, runs one tick, and exits. **No idle cron.** It runs under a least-privilege `permissions:`
block (`contents: read`, `pull-requests: write`) and posts as `github-actions[bot]` via the built-in
token, so `SUPERSERVE_API_KEY` is the only GitHub secret to add; the Superserve secret _names_ are
plain env.

> Fork PRs get a read-only token (can't post) — review those via the PAT path, or
> `pull_request_target` (safe here: PR code only runs in the sandbox, never on the runner). Want a
> safety-net sweep too? Add a `schedule:` trigger back. For a non-GitHub heartbeat, the same
> orchestrator runs on Cloudflare Workers Cron (the SDK is `fetch`-based and runs at the edge).

## Give it a branded avatar

By default reviews come from `github-actions[bot]` with GitHub's generic icon. To make
the bot post under **your own name and profile picture**, give it its own **GitHub App**.

> **Why your own App, not a shared one?** An App's private key is the master credential
> for every place it's installed. Keeping the App — and its key — **yours**, in your own
> repo, means nothing is shared and there's nothing for anyone else to compromise. That's
> the whole self-serve model: your bot, your key, your identity.

**One-time, on GitHub:**

1. **Create the App** — `Settings → Developer settings → GitHub Apps → New GitHub App`:
   - **Name** → becomes the handle (e.g. `acme-pr-loop` → `acme-pr-loop[bot]`).
   - **Homepage URL** → anything (your repo is fine).
   - **Webhook → uncheck "Active"** (this bot is driven by your workflow, not webhooks).
   - **Permissions**: `Contents: Read-only`, `Pull requests: Read & write`, `Issues: Read & write` (labels).
   - Create → note the **App ID** → **Generate a private key** (downloads a `.pem`).
2. **Avatar** → the App's **Display information → upload a logo**. This is the profile picture.
3. **Install** the App on the repo you're reviewing.

**Then wire it in (once), from a checkout of that repo:**

```bash
gh secret set LOOP_APP_ID --body "<your App ID>"
gh secret set LOOP_APP_PRIVATE_KEY < ~/Downloads/your-app.*.private-key.pem
```

Edit `.github/workflows/loop-pr-loop.yml` — add the token-mint step and point the
loop at it:

```yaml
steps:
  - uses: oven-sh/setup-bun@v2
  - uses: actions/create-github-app-token@v1 # official; check for the latest major
    id: app-token
    with:
      app-id: ${{ secrets.LOOP_APP_ID }}
      private-key: ${{ secrets.LOOP_APP_PRIVATE_KEY }}
  - run: bunx @superserve/loops@stable run pr-loop --repo "${{ github.repository }}" --pr "${{ github.event.pull_request.number }}" --once
    env:
      SUPERSERVE_API_KEY: ${{ secrets.SUPERSERVE_API_KEY }}
      SUPERSERVE_CLAUDE_SECRET: claude-oauth
      GITHUB_TOKEN: ${{ steps.app-token.outputs.token }} # was ${{ github.token }}
```

Now reviews post as **`your-app[bot]`** with your avatar. The private key never leaves
your repo's secrets, and the token minted each run is scoped to this one repo for an hour.

> A one-command `--github-app` installer (GitHub's App-manifest flow → one click, key
> stored for you) is on the roadmap. For now these steps are manual.

## Make it review your way

These work with the published loop as-is — nothing to fork.

- **Review norms & the merge bar.** Each run the loop reads your repo's `CLAUDE.md` /
  `AGENTS.md` / `README.md` for the review conventions and what "ready to merge" means
  _here_. Write your team's rules there and reviews follow them.
- **The verifier's checks.** The loop runs your project's _own_ tests / lint / build
  (discovered from `CLAUDE.md`/`AGENTS.md`/`Makefile`/CI on the default branch). Keep
  them defined the normal way — nothing loop-specific.
- **Add your own skills.** Commit them to your repo at `.claude/skills/<name>/SKILL.md`.
  Claude Code runs _inside your cloned repo_, so it discovers project skills automatically
  — no upload step.
  > **Caveat:** a repo skill can only use tools the loop already allows — `gh`, `git`,
  > the common package managers (`npm`/`npx`/`node`/`bun`/`pnpm`/`yarn`), `make`, the
  > common test runners (`pytest`/`python3`/`go`/`cargo`), and `Read`/`Edit`/`Write`/
  > `Glob`/`Grep`. A skill that needs a _new_ command or tool needs the run-from-source path.

## Deeper changes (run from source)

The loop's code ships as the `@superserve/loops` package (your workflow just `bunx`es it),
so changing its _behavior_ means running your own copy: fork/clone `examples/loops`, edit,
then either run it locally (`bun run pr-loop/loop.ts …`) or, in the workflow, replace
the `bunx @superserve/loops@stable …` line with a checkout of your fork + `bun run`.

Knobs live in [`loop.ts`](./loop.ts) (sandbox template, model / `--max-turns`,
the tool allow/deny lists, watch interval) and the review rubric itself is
[`skill/SKILL.md`](./skill/SKILL.md).

### Add your own MCP servers

Giving the reviewer an MCP server (e.g. a Jira, Sentry, or database MCP) has three parts,
and the third is why it needs the from-source path today:

1. **Config** — add a project [`.mcp.json`](https://modelcontextprotocol.io) to your repo
   (Claude Code picks up project MCP servers from the repo it runs in).
2. **Secrets** — bind any server API keys as Superserve secrets (egress-swapped) or env
   vars, so the server can authenticate from inside the box.
3. **Tool policy** — allow the server's `mcp__<server>__*` tools in the loop's
   `--allowedTools` list. That list lives in `loop.ts`, not your repo, so
   enabling MCP means running your edited copy of the loop.

> A built-in MCP passthrough (config + allow-list from the repo, no fork) is a candidate
> for a future release.

## Rotate, revoke, uninstall

**Rotate a credential by re-running the installer.** `add` is idempotent: it **rotates** the
existing Superserve secrets in place (`claude-oauth`, and `loop-github-token` when you pass
`--github-token`), re-sets the `SUPERSERVE_API_KEY` Actions secret, and rewrites the same
workflow file. Programmatic alternative:

```ts
import { Secret } from "@superserve/sdk"
await (await Secret.get("claude-oauth")).rotate(newToken)
```

**The Claude token expires** — `claude setup-token` mints a ~1-year token, and revoking it in
your Claude account settings kills it immediately. Either way, ticks start failing with an auth
error in the Actions log. Fix: run `claude setup-token` again, then re-run the installer (or
rotate the secret as above).

**Revoke access** at any point, independently per credential:

- **Claude** — revoke the OAuth token in your Claude account, and/or delete the `claude-oauth`
  Superserve secret.
- **GitHub (PAT path)** — revoke the PAT in GitHub settings; delete the `loop-github-token` secret.
- **GitHub (App path)** — uninstall the App from the repo (or delete the App); its per-run tokens
  expire within an hour anyway.
- **Superserve** — revoke the API key in the [console](https://console.superserve.ai); the
  orchestrator can no longer reach any sandbox.

**Uninstall the loop:**

1. Delete `.github/workflows/loop-pr-loop.yml` — no more ticks.
2. Kill the warm sandbox (it's paused, so it costs ~nothing, but still): console → Sandboxes →
   the box named `pr-loop`, or via the SDK:
   ```ts
   import { Sandbox } from "@superserve/sdk"
   const [box] = await Sandbox.list({
     metadata: { loop: "pr-loop", repo: "owner/name" },
   })
   if (box) await Sandbox.killById(box.id)
   ```
3. Optionally delete the Superserve secrets (`claude-oauth`, `loop-github-token`) and the repo's
   `SUPERSERVE_API_KEY` Actions secret.

## Troubleshooting

| Symptom                                       | Cause / fix                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Missing credentials: …` in the Actions log   | The workflow env lost a variable. The message lists exactly what's missing — check the `SUPERSERVE_API_KEY` Actions secret and the `SUPERSERVE_CLAUDE_SECRET` / `GITHUB_TOKEN` lines in the workflow.                                                                                              |
| Claude auth error mid-tick                    | The Claude token expired or was revoked — mint a new one (`claude setup-token`) and re-run the installer to rotate `claude-oauth` ([above](#rotate-revoke-uninstall)).                                                                                                                             |
| `setup failed … destroyed sandbox` in the log | First-boot bootstrap (clone / `gh` install / auth) failed. The loop destroys the half-built box **on purpose** so the next tick re-bootstraps from scratch instead of resuming it broken. The streamed log above the error has the real cause — usually a `GITHUB_TOKEN` that can't read the repo. |
| A PR isn't getting reviewed                   | Fork PRs are skipped by design (their token is read-only) — use the PAT path. Drafts are skipped unless opted in. And a head SHA is reviewed **once**: no new commits → no new review.                                                                                                             |
| Tick is slow / times out                      | One tick is capped at **20 minutes**, then the Action fails. Event-driven ticks review one PR; a manual `workflow_dispatch` sweeps _every_ open PR and can take much longer. Re-run from the Actions tab.                                                                                          |
| Two PRs updated at once                       | Fine — the workflow's `concurrency` group serializes ticks per repo (they share one warm box), so the second waits for the first.                                                                                                                                                                  |
| Where are the logs?                           | The sandbox's stdout/stderr stream straight into the GitHub Actions step log. The box itself (state file, repo checkout) is inspectable in the [console](https://console.superserve.ai) — it's the sandbox named `pr-loop`.                                                                        |

## Which key does what

| Name                                   | Kind                    | Purpose                            | Where it lives                                                            |
| -------------------------------------- | ----------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `SUPERSERVE_API_KEY`                   | secret                  | Create/drive the sandbox           | GitHub Actions secret (or local env)                                      |
| `claude-oauth` / `ANTHROPIC_API_KEY`   | Superserve secret / key | The Claude credential the box uses | Superserve secret (subscription) or env (metered)                         |
| `GITHUB_TOKEN`                         | token                   | Clone the repo + post the review   | Built-in Actions token by default; App token or PAT if branded/cross-repo |
| `LOOP_APP_ID` / `LOOP_APP_PRIVATE_KEY` | secret                  | Mint the branded App's token       | GitHub Actions secrets (branded-avatar section only)                      |

The `SUPERSERVE_*_SECRET` env vars hold secret **names**, not values — safe in plain env. The
loop accepts its Claude credential four ways, checked in this order: `SUPERSERVE_CLAUDE_SECRET`
(name of a subscription-token secret — what the installer sets up), raw `CLAUDE_CODE_OAUTH_TOKEN`,
`SUPERSERVE_ANTHROPIC_SECRET` (name of a secret holding a metered `ANTHROPIC_API_KEY`), or raw
`ANTHROPIC_API_KEY`. Raw values live in the box for the run; secret names get the egress swap.

## Safety

- **Never merges, force-pushes, or edits `.github/workflows`.** Strongest action is a review +
  `ready-to-merge` label.
- **Human gates:** security / auth / payments / core-infra changes, unresolved MUST_FIX, or a PR
  stuck across several runs → `@`-mention + `needs-human` label, no auto-action.
- **Prompt-injection firewall:** PR content is treated as data; the skill refuses instructions
  embedded in code/comments and only runs the project's own checks (read from the default branch).
- **Secrets:** the Claude OAuth token is bound via Superserve secret-binding — it never enters the
  box; a proxy token is swapped in at egress. The default GitHub identity uses the workflow's
  short-lived, repo-scoped `GITHUB_TOKEN` (it does enter the box, but expires with the run); the
  cross-repo PAT path keeps the same egress-swap as Claude.
- **Token exposure in the box:** whatever `GITHUB_TOKEN` resolves to is readable by the agent
  (`echo $GITHUB_TOKEN`), so only least-privilege values are allowed in. Default path: the per-run
  Actions token — masked in Actions logs, invalidated when the job ends, bounded by the workflow's
  `contents: read` / `pull-requests: write` block. PAT path: the box sees a Superserve stand-in,
  never the real PAT. A raw PAT enters the box only on the local-dev env-var fallback — prefer
  `SUPERSERVE_GITHUB_SECRET` there too. Write-capable classic PATs are refused outright.
- **Residual PR surface:** `pull-requests: write` (required to post reviews and the two loop
  labels) also technically allows closing or relabeling a PR. Approving is additionally blocked
  for the default token by GitHub's **"Allow GitHub Actions to create and approve pull requests"**
  setting — off by default; leave it off so the loop's reviews can never satisfy branch
  protection. The skill forbids all of these and close/reopen/ready are on the deny list, but
  under `bypassPermissions` those are guardrails, not guarantees — the guarantee is that the
  token can never merge or push.

## How it maps to the loop-engineering primitives

| Primitive      | Here                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| Scheduling     | GitHub Actions `pull_request` events (the heartbeat)                       |
| Memory / State | `.pr-loop-state.md` in the warm box, deduped by head SHA                   |
| Worktrees      | `git worktree` **inside** the microVM (branch + host isolation)            |
| Sub-agents     | maker (review) / checker (run the project's tests) split                   |
| Skills         | [`skill/SKILL.md`](./skill/SKILL.md), discovered by Claude Code in the box |
| Connectors     | `gh` CLI in the box (swap for the GitHub MCP server if you prefer)         |
