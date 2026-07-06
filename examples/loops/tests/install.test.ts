import { describe, expect, it } from "vitest"

import { buildWorkflow, extractOAuthToken } from "../install/cli"

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
