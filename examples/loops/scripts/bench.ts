import { Sandbox } from "@superserve/sdk"

// Live runtime check for the PR Loop design: boot the claude-code template,
// confirm the `claude` harness is present, run the loop's real "cold setup"
// (install gh + clone), pause, then resume warm by metadata (exactly like the
// orchestrator) and confirm state persisted. Prints the warm-vs-cold numbers.
//
//   SUPERSERVE_API_KEY=ss_live_... bun run examples/loops/scripts/bench.ts

const META = { loop: "smoke", run: "pr-loop-bench" }
const now = (): number => performance.now()
const secs = (ms: number): string => (ms / 1000).toFixed(1)

async function main(): Promise<void> {
  // Clean up anything a prior run left behind.
  for (const s of await Sandbox.list({ metadata: META })) {
    await Sandbox.killById(s.id)
  }

  console.log("[1] creating box from superserve/claude-code ...")
  const t0 = now()
  const box = await Sandbox.create({
    name: "pr-loop-smoke",
    fromTemplate: "superserve/claude-code",
    metadata: META,
  })
  const tCreate = now() - t0
  console.log(`    created ${box.id} in ${secs(tCreate)}s`)

  // From here on the box exists: run the whole benchmark inside try/finally so
  // any throw (setup timeout, pause, resume) still kills it instead of leaking
  // a billed sandbox.
  try {
    await benchmark()
  } finally {
    await Sandbox.killById(box.id).catch(() => {})
    console.log("killed box. done.")
  }

  async function benchmark(): Promise<void> {
    const ver = await box.commands.run(
      "claude --version 2>&1 || echo 'NO CLAUDE'",
    )
    console.log(`    harness: ${ver.stdout.trim()}`)

    console.log("[2] cold setup (install gh + clone) ...")
    const setup = [
      'export PATH="$HOME/.local/bin:$PATH"',
      "if ! command -v gh >/dev/null 2>&1; then GH=2.63.2;" +
        ' curl -fsSL "https://github.com/cli/cli/releases/download/v${GH}/gh_${GH}_linux_amd64.tar.gz" -o /tmp/gh.tgz' +
        ' && mkdir -p "$HOME/.local/bin" && tar -xzf /tmp/gh.tgz -C /tmp' +
        ' && cp "/tmp/gh_${GH}_linux_amd64/bin/gh" "$HOME/.local/bin/gh"; fi',
      "git clone --depth 1 https://github.com/octocat/Hello-World /home/user/repo",
      "gh --version | head -1",
      'echo "warm-marker $(date -u +%s)" > /home/user/repo/.smoke-state',
    ].join(" && ")
    const t1 = now()
    const setupRes = await box.commands.run(setup, {
      timeoutMs: 5 * 60_000,
      onStdout: (d) => process.stdout.write(d),
      onStderr: (d) => process.stderr.write(d),
    })
    const tSetup = now() - t1
    console.log(`    setup exit ${setupRes.exitCode} in ${secs(tSetup)}s`)

    console.log("[3] pausing ...")
    await box.pause()

    console.log("[4] warm resume (list by metadata + connect) ...")
    const t2 = now()
    const [info] = await Sandbox.list({ metadata: META })
    // Paused boxes can be excluded or listing can lag — fail with a real message
    // instead of a TypeError on `info.id` (the finally above still cleans up).
    if (!info) {
      throw new Error(
        "warm resume failed: list() returned no box for the bench metadata",
      )
    }
    const warm = await Sandbox.connect(info.id)
    const check = await warm.commands.run(
      "cat /home/user/repo/.smoke-state && ls /home/user/repo >/dev/null && echo RESUMED-WARM",
    )
    const tWarm = now() - t2
    console.log(
      `    warm tick in ${secs(tWarm)}s — ${check.stdout.trim().replace(/\n/g, " | ")}`,
    )
    await warm.pause()

    console.log("\n=== HERO NUMBERS ===")
    console.log(`cold start (create + setup): ${secs(tCreate + tSetup)}s`)
    console.log(`warm tick   (resume + run):  ${secs(tWarm)}s`)
    console.log(`warm is ${((tCreate + tSetup) / tWarm).toFixed(1)}x faster\n`)
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
