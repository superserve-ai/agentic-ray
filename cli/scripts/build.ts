import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

const targets = [
  "bun-linux-x64",
  "bun-linux-x64-baseline",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
] as const

const distDir = resolve(import.meta.dir, "../dist")
mkdirSync(distDir, { recursive: true })

const entrypoint = resolve(import.meta.dir, "../src/index.ts")

for (const target of targets) {
  const ext = target.includes("windows") ? ".exe" : ""
  const outfile = resolve(distDir, `superserve-${target}${ext}`)

  console.log(`Building ${target}...`)

  const proc = Bun.spawnSync(
    [
      "bun",
      "build",
      "--compile",
      `--target=${target}`,
      `--outfile=${outfile}`,
      entrypoint,
    ],
    {
      stderr: "pipe",
      stdout: "pipe",
    },
  )

  if (proc.exitCode !== 0) {
    console.error(`  Failed: ${proc.stderr.toString()}`)
  } else {
    console.log(`  Done: ${outfile}`)
  }
}

console.log("\nBuild complete!")
