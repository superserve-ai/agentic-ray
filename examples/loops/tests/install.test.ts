import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { describe, expect, it } from "vitest"
import { parse } from "yaml"

import {
  buildWorkflow,
  commitAndPushWorkflow,
  extractOAuthToken,
  planPush,
} from "../install/cli"

/** The parsed shape of the generated workflow — just what the tests assert on. */
interface ParsedWorkflow {
  on: { pull_request: { types: string[] } }
  permissions: Record<string, string>
  jobs: {
    tick: {
      steps: Array<{
        id?: string
        uses?: string
        run?: string
        with?: Record<string, string>
        env?: Record<string, string>
      }>
    }
  }
}

describe("buildWorkflow", () => {
  it("defaults to the github-actions[bot] built-in token — no PAT, least-privilege perms", () => {
    const wf = buildWorkflow()

    // Event-driven: runs on PR code changes (a pushed commit), not on a clock.
    expect(wf).toContain("pull_request:")
    expect(wf).toContain("synchronize")
    expect(wf).not.toContain("cron:")

    // Runs the PUBLISHED package on the Superserve-gated `@stable` channel — the whole
    // point of this workflow. No loop source is vendored into the repo, so there is no
    // repo checkout, no local `bun install`, and no `.superserve/loops` working dir.
    expect(wf).toContain("bunx @superserve/loops@stable run pr-loop")
    expect(wf).not.toContain(".superserve/loops")
    expect(wf).not.toContain("working-directory")
    expect(wf).not.toContain("actions/checkout")
    expect(wf).not.toContain("bun install")
    expect(wf).not.toContain("bun run pr-loop/loop.ts")

    // Per-PR focus: pass the triggering PR number (empty on manual dispatch → sweep).
    expect(wf).toContain('--pr "${{ github.event.pull_request.number }}"')
    // Skip fork PRs (no secrets / read-only token); same-repo PRs + dispatch still run.
    expect(wf).toContain("head.repo.full_name == github.repository")

    // Identity: the workflow's own token, so reviews post as github-actions[bot].
    expect(wf).toContain("GITHUB_TOKEN: ${{ github.token }}")
    // No PAT / Superserve GitHub secret on the default same-repo path.
    expect(wf).not.toContain("SUPERSERVE_GITHUB_SECRET")

    // Least privilege: clone the repo + post the review/labels, nothing else.
    expect(wf).toContain("permissions:")
    expect(wf).toContain("contents: read")
    expect(wf).toContain("pull-requests: write")
  })

  it("uses a PAT Superserve secret for the cross-repo / custom-identity fallback", () => {
    const wf = buildWorkflow({ githubSecret: "loop-github-token" })

    expect(wf).toContain("SUPERSERVE_GITHUB_SECRET: loop-github-token")
    // The built-in token is dropped when a PAT identity is chosen.
    expect(wf).not.toContain("github.token")
    // Permissions block is still least-privilege regardless of identity path.
    expect(wf).toContain("pull-requests: write")
  })

  it("mints a GitHub App installation token for the branded-bot identity", () => {
    const wf = buildWorkflow({ githubApp: true })

    // The token-minting step runs before the loop, keyed to app-id/private-key
    // secrets that resolve from repo OR org scope.
    expect(wf).toContain("actions/create-github-app-token@v1")
    expect(wf).toContain("id: app-token")
    expect(wf).toContain("app-id: ${{ secrets.LOOP_APP_ID }}")
    expect(wf).toContain("private-key: ${{ secrets.LOOP_APP_PRIVATE_KEY }}")

    // The loop posts with the minted token — not the built-in one or a PAT secret.
    expect(wf).toContain("GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}")
    expect(wf).not.toContain("github.token")
    expect(wf).not.toContain("SUPERSERVE_GITHUB_SECRET")

    // App identity wins over a PAT secret if both are somehow passed.
    const both = buildWorkflow({
      githubApp: true,
      githubSecret: "loop-github-token",
    })
    expect(both).toContain("steps.app-token.outputs.token")
    expect(both).not.toContain("SUPERSERVE_GITHUB_SECRET")
  })
})

describe("buildWorkflow — structural (parsed YAML)", () => {
  // The substring assertions above can't catch indentation drift or a dropped
  // newline that silently joins one step onto another — parse the document and
  // assert the structure survives in every identity mode.
  it("parses to a valid least-privilege workflow in every identity mode", () => {
    for (const opts of [
      {},
      { githubSecret: "loop-github-token" },
      { githubApp: true },
    ]) {
      const doc = parse(buildWorkflow(opts)) as ParsedWorkflow
      expect(doc.on.pull_request.types).toContain("synchronize")
      expect(doc.permissions).toEqual({
        contents: "read",
        "pull-requests": "write",
      })
      expect(Array.isArray(doc.jobs.tick.steps)).toBe(true)
    }
  })

  it("default mode: two steps, built-in token wired into the run env", () => {
    const doc = parse(buildWorkflow()) as ParsedWorkflow
    const steps = doc.jobs.tick.steps
    expect(steps).toHaveLength(2)
    expect(steps[0].uses).toBe("oven-sh/setup-bun@v2")
    expect(steps[1].run).toContain("run pr-loop")
    expect(steps[1].env?.GITHUB_TOKEN).toBe("${{ github.token }}")
    expect(steps[1].env?.SUPERSERVE_API_KEY).toBe(
      "${{ secrets.SUPERSERVE_API_KEY }}",
    )
  })

  it("App mode: the token-mint step is a separate FIRST step feeding the run env", () => {
    const doc = parse(buildWorkflow({ githubApp: true })) as ParsedWorkflow
    const steps = doc.jobs.tick.steps
    expect(steps).toHaveLength(3)
    expect(steps[0].uses).toBe("actions/create-github-app-token@v1")
    expect(steps[0].id).toBe("app-token")
    expect(steps[0].with?.["app-id"]).toBe("${{ secrets.LOOP_APP_ID }}")
    expect(steps[0].with?.["private-key"]).toBe(
      "${{ secrets.LOOP_APP_PRIVATE_KEY }}",
    )
    expect(steps[1].uses).toBe("oven-sh/setup-bun@v2")
    expect(steps[2].run).toContain("run pr-loop")
    expect(steps[2].env?.GITHUB_TOKEN).toBe(
      "${{ steps.app-token.outputs.token }}",
    )
  })
})

describe("planPush", () => {
  it("never auto-pushes over pre-existing unpublished commits — even with --yes", () => {
    expect(planPush({ aheadBeforeCommit: 2, yes: true, isTTY: true })).toEqual({
      action: "skip",
      reason: "ahead",
    })
  })

  it("skips when there is no upstream to push to", () => {
    expect(
      planPush({ aheadBeforeCommit: undefined, yes: true, isTTY: true }),
    ).toEqual({ action: "skip", reason: "no-upstream" })
  })

  it("pushes without prompting only under explicit --yes", () => {
    expect(planPush({ aheadBeforeCommit: 0, yes: true, isTTY: false })).toEqual(
      { action: "push" },
    )
  })

  it("prompts interactively, and skips when it can't prompt", () => {
    expect(planPush({ aheadBeforeCommit: 0, yes: false, isTTY: true })).toEqual(
      { action: "confirm" },
    )
    expect(
      planPush({ aheadBeforeCommit: 0, yes: false, isTTY: false }),
    ).toEqual({ action: "skip", reason: "needs-confirmation" })
  })
})

// --- commitAndPushWorkflow against real throwaway git repos ------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

/** A repo with one seed commit and repo-local config that keeps the
 *  installer's own git calls deterministic (no signing, fixed identity). */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "loops-install-test-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.name", "loops-test")
  git(dir, "config", "user.email", "test@superserve.ai")
  git(dir, "config", "commit.gpgsign", "false")
  writeFileSync(join(dir, "README.md"), "seed\n")
  git(dir, "add", "README.md")
  git(dir, "commit", "-qm", "seed")
  return dir
}

/** Wire the repo to a local bare "origin" and set the upstream. */
function addUpstream(repo: string): string {
  const bare = mkdtempSync(join(tmpdir(), "loops-upstream-"))
  git(bare, "init", "-q", "--bare", "-b", "main")
  git(repo, "remote", "add", "origin", bare)
  git(repo, "push", "-qu", "origin", "main")
  return bare
}

function writeWorkflowFile(repo: string): string {
  const wf = join(repo, ".github", "workflows", "loop-pr-loop.yml")
  mkdirSync(dirname(wf), { recursive: true })
  writeFileSync(wf, buildWorkflow())
  return wf
}

describe("commitAndPushWorkflow", () => {
  it("commits ONLY the workflow file — the user's staged work stays staged", async () => {
    const repo = makeRepo()
    // Unrelated work the user had staged before running the installer.
    writeFileSync(join(repo, "unrelated.txt"), "user work\n")
    git(repo, "add", "unrelated.txt")
    const wf = writeWorkflowFile(repo)

    await commitAndPushWorkflow(repo, wf, {
      dryRun: false,
      push: true,
      yes: true,
    })

    // The installer commit contains exactly the workflow file…
    const committed = git(repo, "show", "--name-only", "--format=", "HEAD")
      .split("\n")
      .filter(Boolean)
    expect(committed).toEqual([".github/workflows/loop-pr-loop.yml"])
    // …and the unrelated staged file was not swept into it.
    expect(git(repo, "diff", "--cached", "--name-only")).toBe("unrelated.txt")
  })

  it("refuses to auto-push when the branch was already ahead — even with --yes", async () => {
    const repo = makeRepo()
    const bare = addUpstream(repo)
    // Unpublished local work: one commit ahead of origin/main.
    writeFileSync(join(repo, "wip.txt"), "unpublished\n")
    git(repo, "add", "wip.txt")
    git(repo, "commit", "-qm", "wip: not for publishing")
    const upstreamBefore = git(bare, "rev-parse", "refs/heads/main")
    const wf = writeWorkflowFile(repo)

    await commitAndPushWorkflow(repo, wf, {
      dryRun: false,
      push: true,
      yes: true,
    })

    // Committed locally…
    expect(git(repo, "log", "-1", "--format=%s")).toBe(
      "Add pr-loop GitHub Actions workflow",
    )
    // …but nothing was published: upstream did not move.
    expect(git(bare, "rev-parse", "refs/heads/main")).toBe(upstreamBefore)
  })

  it("pushes exactly the one workflow commit when in sync and consented via --yes", async () => {
    const repo = makeRepo()
    const bare = addUpstream(repo)
    const upstreamBefore = git(bare, "rev-parse", "refs/heads/main")
    const wf = writeWorkflowFile(repo)

    await commitAndPushWorkflow(repo, wf, {
      dryRun: false,
      push: true,
      yes: true,
    })

    const upstreamAfter = git(bare, "rev-parse", "refs/heads/main")
    expect(upstreamAfter).not.toBe(upstreamBefore)
    expect(
      git(bare, "rev-list", "--count", `${upstreamBefore}..${upstreamAfter}`),
    ).toBe("1")
  })

  it("commits but does not push when push:false (App mode without its secrets)", async () => {
    const repo = makeRepo()
    const bare = addUpstream(repo)
    const upstreamBefore = git(bare, "rev-parse", "refs/heads/main")
    const wf = writeWorkflowFile(repo)

    await commitAndPushWorkflow(repo, wf, {
      dryRun: false,
      push: false,
      yes: true,
    })

    expect(git(repo, "log", "-1", "--format=%s")).toBe(
      "Add pr-loop GitHub Actions workflow",
    )
    expect(git(bare, "rev-parse", "refs/heads/main")).toBe(upstreamBefore)
  })
})

describe("extractOAuthToken", () => {
  it("pulls the sk-ant-oat01 token out of `claude setup-token` output", () => {
    const out =
      "Opened browser to sign in.\nYour long-lived token:\n" +
      "sk-ant-oat01-AbC_dEf-123xyz\nStore it as CLAUDE_CODE_OAUTH_TOKEN.\n"
    expect(extractOAuthToken(out)).toBe("sk-ant-oat01-AbC_dEf-123xyz")
  })

  it("returns undefined when no token is present (caller falls back to a paste)", () => {
    expect(extractOAuthToken("no token here")).toBeUndefined()
    expect(extractOAuthToken("")).toBeUndefined()
  })
})
