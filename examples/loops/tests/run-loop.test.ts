import { describe, expect, it } from "vitest"

import { runLoop } from "../lib/run-loop"
import type {
  LoopSpec,
  RunResult,
  SandboxHandle,
  SandboxOps,
} from "../lib/run-loop"
import {
  assertTokenScope,
  buildSpec,
  parsePrFlag,
  parseRepoUrl,
  resolveAuth,
  runTick,
  writeCapableScopes,
} from "../pr-loop/loop"

// Loop code always passes the same metadata object (stable key order), so a
// plain stringify is a sufficient and deterministic map key here.
function metaKey(m: Record<string, string>): string {
  return JSON.stringify(m)
}

/** In-memory stand-in for a live Superserve sandbox. */
class FakeBox implements SandboxHandle {
  readonly id: string
  writes: Array<{ path: string; content: string }> = []
  runs: string[] = []
  /** Per-command env passed at run time, keyed by command (last write wins). */
  runEnv: Record<string, Record<string, string> | undefined> = {}
  paused = false
  killed = false
  /** Per-command exit codes; any command not listed exits 0 (clean). */
  exitCodes: Record<string, number> = {}

  constructor(id: string) {
    this.id = id
  }

  files = {
    write: async (path: string, content: string): Promise<void> => {
      this.writes.push({ path, content })
    },
  }

  commands = {
    run: async (
      command: string,
      options?: { env?: Record<string, string> },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      this.runs.push(command)
      this.runEnv[command] = options?.env
      return { stdout: "", stderr: "", exitCode: this.exitCodes[command] ?? 0 }
    },
  }

  pause = async (): Promise<void> => {
    this.paused = true
  }

  kill = async (): Promise<void> => {
    this.killed = true
  }
}

/** In-memory `SandboxOps` that persists boxes by metadata, like the real platform. */
class FakeOps implements SandboxOps {
  boxesByMeta = new Map<string, FakeBox>()
  boxesById = new Map<string, FakeBox>()
  createCount = 0
  connectCount = 0
  /** Hook to configure each freshly created box (e.g. make its setup fail). */
  onCreate?: (box: FakeBox) => void
  private seq = 0

  /** Pretend a prior tick already created this loop's box. */
  seed(metadata: Record<string, string>): FakeBox {
    const box = new FakeBox(`box-${++this.seq}`)
    this.boxesByMeta.set(metaKey(metadata), box)
    this.boxesById.set(box.id, box)
    return box
  }

  list = async (
    metadata: Record<string, string>,
  ): Promise<Array<{ id: string }>> => {
    const box = this.boxesByMeta.get(metaKey(metadata))
    // A killed box is gone from the platform — the next tick won't rediscover it.
    return box && !box.killed ? [{ id: box.id }] : []
  }

  connect = async (id: string): Promise<SandboxHandle> => {
    this.connectCount++
    const box = this.boxesById.get(id)
    if (!box) throw new Error(`no box ${id}`)
    return box
  }

  create = async (options: {
    name: string
    metadata: Record<string, string>
  }): Promise<SandboxHandle> => {
    this.createCount++
    const box = new FakeBox(`box-${++this.seq}`)
    this.boxesByMeta.set(metaKey(options.metadata), box)
    this.boxesById.set(box.id, box)
    this.onCreate?.(box)
    return box
  }
}

const spec: LoopSpec = {
  name: "t",
  metadata: { loop: "t", repo: "o/r" },
  uploads: { "/x": "data" },
  setup: "SETUP",
  iterate: "ITERATE",
}

const noop = (): void => {}

describe("runLoop", () => {
  it("cold start: creates, uploads, runs setup then iterate, pauses", async () => {
    const ops = new FakeOps()
    const result = await runLoop(spec, ops, noop)

    expect(result.bootstrapped).toBe(true)
    expect(ops.createCount).toBe(1)
    expect(ops.connectCount).toBe(0)

    const box = ops.boxesById.get(result.sandboxId)
    expect(box?.writes).toEqual([{ path: "/x", content: "data" }])
    expect(box?.runs).toEqual(["SETUP", "ITERATE"])
    expect(box?.paused).toBe(true)
  })

  it("warm tick: resumes the existing box, runs iterate only (no setup, no uploads)", async () => {
    const ops = new FakeOps()
    ops.seed(spec.metadata)
    const result = await runLoop(spec, ops, noop)

    expect(result.bootstrapped).toBe(false)
    expect(ops.createCount).toBe(0)
    expect(ops.connectCount).toBe(1)

    const box = ops.boxesById.get(result.sandboxId)
    expect(box?.writes).toEqual([])
    expect(box?.runs).toEqual(["ITERATE"])
    expect(box?.paused).toBe(true)
  })

  it("re-injects envVars into the iterate command on a warm tick (rotating creds)", async () => {
    // The GitHub Actions `github.token` is minted per-run and dies with that run.
    // A warm resume binds nothing new at create, so iterate MUST receive the
    // current run's envVars or it 401s against the first tick's expired token.
    const ops = new FakeOps()
    ops.seed(spec.metadata)
    const envVars = { GITHUB_TOKEN: "fresh-token", TARGET_REPO: "o/r" }
    const result = await runLoop({ ...spec, envVars }, ops, noop)

    const box = ops.boxesById.get(result.sandboxId)
    expect(box?.runEnv["ITERATE"]).toEqual(envVars)
  })

  it("respects pauseWhenDone: false", async () => {
    const ops = new FakeOps()
    const result = await runLoop({ ...spec, pauseWhenDone: false }, ops, noop)
    expect(ops.boxesById.get(result.sandboxId)?.paused).toBe(false)
  })

  it("setup failure: tears the box down, skips iterate + pause, and rethrows", async () => {
    const ops = new FakeOps()
    ops.onCreate = (box) => {
      box.exitCodes.SETUP = 1
    }

    await expect(runLoop(spec, ops, noop)).rejects.toThrow(/setup failed/)

    const box = [...ops.boxesById.values()][0]
    expect(box?.runs).toEqual(["SETUP"]) // never advanced to iterate
    expect(box?.killed).toBe(true) // half-built box destroyed
    expect(box?.paused).toBe(false) // don't pause a torn-down box
    // The platform no longer lists it, so the next tick re-bootstraps cleanly.
    expect(await ops.list(spec.metadata)).toEqual([])
  })

  it("surfaces a non-zero iterate exit code instead of swallowing or throwing it", async () => {
    const ops = new FakeOps()
    ops.onCreate = (box) => {
      box.exitCodes.ITERATE = 1
    }

    // A failed *iterate* (unlike a failed *setup*) is a return value, not a
    // throw: the box is healthy, so the orchestrator — not the spine — decides
    // what to do with the code. The one-shot path turns it into a non-zero
    // process exit so a scheduled `--once` run goes red, not silently green.
    const result = await runLoop(spec, ops, noop)

    expect(result.exitCode).toBe(1)
    const box = ops.boxesById.get(result.sandboxId)
    expect(box?.runs).toEqual(["SETUP", "ITERATE"]) // ran iterate, didn't bail
    expect(box?.paused).toBe(true) // a failed tick still pauses (stops billing)
  })
})

describe("pr-loop buildSpec / resolveAuth", () => {
  it("binds the subscription + github secrets by name", () => {
    const auth = resolveAuth({
      SUPERSERVE_CLAUDE_SECRET: "claude-oauth",
      SUPERSERVE_GITHUB_SECRET: "loop-github-token",
    } as NodeJS.ProcessEnv)

    expect(auth.secrets).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth",
      GITHUB_TOKEN: "loop-github-token",
    })
    expect(auth.envVars).toEqual({})
  })

  it("falls back to raw tokens in env vars (dev path)", () => {
    const auth = resolveAuth({
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      GITHUB_TOKEN: "ght",
    } as NodeJS.ProcessEnv)

    expect(auth.envVars).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      GITHUB_TOKEN: "ght",
    })
    expect(auth.secrets).toEqual({})
  })

  it("accepts GH_TOKEN as a GitHub fallback (the gh CLI's variable)", () => {
    const auth = resolveAuth({
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      GH_TOKEN: "gh-cli-token",
    } as NodeJS.ProcessEnv)

    expect(auth.envVars.GITHUB_TOKEN).toBe("gh-cli-token")
    expect(auth.secrets).toEqual({})
  })

  it("throws a helpful error when credentials are missing", () => {
    expect(() => resolveAuth({} as NodeJS.ProcessEnv)).toThrow(
      /Missing credentials/,
    )
  })

  it("builds a claude-code loop spec wired for subscription auth", () => {
    const auth = resolveAuth({
      SUPERSERVE_CLAUDE_SECRET: "claude-oauth",
      SUPERSERVE_GITHUB_SECRET: "loop-github-token",
    } as NodeJS.ProcessEnv)
    const built = buildSpec({ repo: "acme/widget", skill: "SKILL-BODY", auth })

    expect(built.template).toBe("superserve/claude-code")
    expect(built.metadata).toEqual({
      loop: "pr-loop",
      repo: "acme/widget",
    })
    expect(built.envVars?.TARGET_REPO).toBe("acme/widget")
    expect(Object.values(built.uploads ?? {})).toContain("SKILL-BODY")
    expect(built.iterate).toContain("claude -p")
    expect(built.iterate).toContain("unset ANTHROPIC_API_KEY")
    expect(built.iterate).toContain("set -e")
    expect(built.setup).toContain("git clone")
    expect(built.setup).toContain("credential.helper")
    // Defense-in-depth deny list: merge/push plus the PR-state mutations the
    // loop never needs. (`gh pr review`/`gh pr edit` stay allowed — posting the
    // review and the two loop labels needs them; the skill's hard rules cover
    // approve / other labels / --base.)
    for (const denied of [
      "Bash(gh pr merge*)",
      "Bash(git push*)",
      "Bash(gh pr close*)",
      "Bash(gh pr reopen*)",
      "Bash(gh pr ready*)",
    ]) {
      expect(built.iterate).toContain(denied)
    }
    // No --pr → sweep every open PR.
    expect(built.iterate).toContain("Review the open PRs in $TARGET_REPO")
    // An agent-side failure (turn limit, rate limit) is labeled so a red tick
    // is distinguishable from the sandbox infrastructure breaking: the claude
    // run is un-guarded (`set +e`), its exit captured, and re-raised with a
    // marker line.
    expect(built.iterate).toContain("set +e")
    expect(built.iterate).toContain("CLAUDE_EXIT=$?")
    expect(built.iterate).toContain("review incomplete")
  })

  it("refreshes the warm checkout to the latest default branch every tick", () => {
    const auth = resolveAuth({
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      GITHUB_TOKEN: "ght",
    } as NodeJS.ProcessEnv)
    const built = buildSpec({ repo: "acme/widget", skill: "S", auth })

    // `git fetch` alone only moves the origin/* refs; the default-branch working
    // tree (where the reviewer reads CLAUDE.md / AGENTS.md / the test & lint
    // commands) would stay at the clone-time SHA and go stale as the branch moves.
    // Every tick must re-derive the default branch and hard-reset the checkout to
    // the fetched remote tip so project context is never stale.
    expect(built.iterate).toContain("git fetch --all --prune")
    expect(built.iterate).toContain("symbolic-ref")
    // Before assuming `main`, ask the remote what HEAD actually points at —
    // a master-default repo with a broken origin/HEAD must not wedge on a
    // checkout of a branch that doesn't exist.
    expect(built.iterate).toContain("git ls-remote --symref origin HEAD")
    expect(built.iterate).toContain(
      '-B "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH"',
    )
  })

  it("focuses the tick on one PR when given --pr", () => {
    const auth = resolveAuth({
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      GITHUB_TOKEN: "ght",
    } as NodeJS.ProcessEnv)
    const built = buildSpec({ repo: "acme/widget", skill: "S", auth, pr: 42 })

    expect(built.iterate).toContain("Review pull request #42 in $TARGET_REPO")
    expect(built.iterate).not.toContain("Review the open PRs")
    // One box per repo regardless of which PR fired — the metadata key omits the PR.
    expect(built.metadata).toEqual({
      loop: "pr-loop",
      repo: "acme/widget",
    })
  })

  it("supports a metered Anthropic key (keeps ANTHROPIC_API_KEY in the box)", () => {
    const auth = resolveAuth({
      ANTHROPIC_API_KEY: "sk-ant",
      GITHUB_TOKEN: "ght",
    } as NodeJS.ProcessEnv)
    expect(auth.claudeMode).toBe("metered")
    expect(auth.envVars).toEqual({
      ANTHROPIC_API_KEY: "sk-ant",
      GITHUB_TOKEN: "ght",
    })

    const built = buildSpec({ repo: "a/b", skill: "S", auth })
    expect(built.iterate).not.toContain("unset ANTHROPIC_API_KEY")
  })
})

describe("pr-loop one-shot exit propagation", () => {
  const fakeResult = (exitCode: number): RunResult => ({
    sandboxId: "box-1",
    bootstrapped: false,
    exitCode,
    stdout: "",
  })

  it("returns the iterate exit code so a failed --once tick can exit non-zero", async () => {
    const code = await runTick(spec, async () => fakeResult(1), noop)
    expect(code).toBe(1)
  })

  it("returns 0 when the tick succeeds", async () => {
    const code = await runTick(spec, async () => fakeResult(0), noop)
    expect(code).toBe(0)
  })
})

describe("token scope gate", () => {
  const fetchWithScopes = (scopes: string | null): typeof fetch =>
    (async () =>
      new Response(
        "",
        scopes === null ? undefined : { headers: { "x-oauth-scopes": scopes } },
      )) as unknown as typeof fetch

  const neverFetch = (async () => {
    throw new Error("must not introspect this token type")
  }) as unknown as typeof fetch

  it("fails closed on a write-capable classic PAT (repo scope = push + merge)", async () => {
    await expect(
      assertTokenScope("ghp_classic", {
        fetchImpl: fetchWithScopes("repo, read:org"),
        allowWrite: false,
      }),
    ).rejects.toThrow(/write-capable/)
  })

  it("accepts a read-only classic PAT", async () => {
    await expect(
      assertTokenScope("ghp_classic", {
        fetchImpl: fetchWithScopes("read:org"),
        allowWrite: false,
      }),
    ).resolves.toBeUndefined()
  })

  it("skips introspection for per-run Actions/App and fine-grained tokens", async () => {
    // ghs_ is bounded by the workflow's permissions block; github_pat_ can't
    // report scopes at all — both are the documented least-privilege paths.
    await expect(
      assertTokenScope("ghs_run_token", { fetchImpl: neverFetch }),
    ).resolves.toBeUndefined()
    await expect(
      assertTokenScope("github_pat_fine_grained", { fetchImpl: neverFetch }),
    ).resolves.toBeUndefined()
  })

  it("honors the explicit escape hatch", async () => {
    await expect(
      assertTokenScope("ghp_classic", {
        fetchImpl: fetchWithScopes("repo"),
        allowWrite: true,
      }),
    ).resolves.toBeUndefined()
  })

  it("does not block when introspection itself fails (offline dev — the API call would fail later anyway)", async () => {
    const failing = (async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    await expect(
      assertTokenScope("ghp_classic", {
        fetchImpl: failing,
        allowWrite: false,
      }),
    ).resolves.toBeUndefined()
  })

  it("classifies write-capable classic scopes", () => {
    expect(writeCapableScopes("repo, read:org")).toEqual(["repo"])
    expect(writeCapableScopes("workflow")).toEqual(["workflow"])
    expect(writeCapableScopes("admin:org, write:packages")).toEqual([
      "admin:org",
      "write:packages",
    ])
    expect(writeCapableScopes("read:org, read:user")).toEqual([])
    expect(writeCapableScopes(null)).toEqual([])
    expect(writeCapableScopes("")).toEqual([])
  })
})

describe("parsePrFlag", () => {
  it("accepts a positive integer", () => {
    expect(parsePrFlag("42")).toBe(42)
  })

  it("treats empty / missing as sweep-all (undefined)", () => {
    // Manual `workflow_dispatch` passes `--pr ""`; local runs omit it entirely.
    expect(parsePrFlag("")).toBeUndefined()
    expect(parsePrFlag(undefined)).toBeUndefined()
  })

  it("rejects non-positive and non-numeric values", () => {
    expect(parsePrFlag("0")).toBeUndefined()
    expect(parsePrFlag("-1")).toBeUndefined()
    expect(parsePrFlag("12.5")).toBeUndefined()
    expect(parsePrFlag("abc")).toBeUndefined()
  })

  it("rejects shell-injection attempts (digits-only guard)", () => {
    // The value is interpolated into the claude prompt, so anything but digits
    // must be refused rather than reaching the shell.
    expect(parsePrFlag("42; rm -rf /")).toBeUndefined()
    expect(parsePrFlag("$(whoami)")).toBeUndefined()
    expect(parsePrFlag("1 || true")).toBeUndefined()
  })
})

describe("parseRepoUrl", () => {
  it("parses https, ssh, .git, and trailing-slash remotes to owner/name", () => {
    for (const url of [
      "https://github.com/acme/widget",
      "https://github.com/acme/widget.git",
      "https://github.com/acme/widget/",
      "git@github.com:acme/widget.git",
      "git@github.com:acme/widget/",
    ]) {
      expect(parseRepoUrl(url)).toBe("acme/widget")
    }
  })

  it("returns undefined for empty or non-github remotes (fall back to --repo)", () => {
    expect(parseRepoUrl(undefined)).toBeUndefined()
    expect(parseRepoUrl("")).toBeUndefined()
    expect(parseRepoUrl("https://gitlab.com/acme/widget.git")).toBeUndefined()
  })
})
