import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

const EXCLUDE_DIRS = new Set([
  "__pycache__",
  ".git",
  ".venv",
  "venv",
  "node_modules",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "dist",
  "build",
])

const EXCLUDE_FILE_PREFIXES = [".env"]

function shouldExclude(
  filePath: string,
  rootDir: string,
  userIgnores?: Set<string>,
): boolean {
  const rel = relative(rootDir, filePath)
  const parts = rel.split(sep)

  // Check built-in directory exclusions
  for (const part of parts) {
    if (EXCLUDE_DIRS.has(part) || part.endsWith(".egg-info")) {
      return true
    }
  }

  // Check built-in file exclusions
  const fileName = parts[parts.length - 1]
  if (EXCLUDE_FILE_PREFIXES.some((p) => fileName.startsWith(p))) {
    return true
  }

  // Check user-specified ignore patterns
  if (userIgnores) {
    const relPosix = rel.split(sep).join("/")
    for (const pattern of userIgnores) {
      if (relPosix === pattern || relPosix.startsWith(`${pattern}/`)) {
        return true
      }
    }
  }

  return false
}

function collectFiles(
  dir: string,
  rootDir: string,
  userIgnores?: Set<string>,
): string[] {
  const files: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (shouldExclude(fullPath, rootDir, userIgnores)) continue

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, rootDir, userIgnores))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

export async function makeTarball(
  projectDir: string,
  userIgnores?: Set<string>,
): Promise<Uint8Array> {
  const files = collectFiles(projectDir, projectDir, userIgnores)

  // Use Bun's built-in tar support if available, otherwise use a manual approach
  // For now, we use the tar command via shell since Bun's native tar API is simpler
  const { tmpdir } = await import("node:os")
  const { join: pathJoin } = await import("node:path")
  const { writeFileSync, mkdtempSync } = await import("node:fs")

  const tmpDir = mkdtempSync(pathJoin(tmpdir(), "superserve-"))
  const fileListPath = pathJoin(tmpDir, "files.txt")
  const tarballPath = pathJoin(tmpDir, "agent.tar.gz")

  // Write file list for tar
  const relativeFiles = files.map((f) => relative(projectDir, f))
  writeFileSync(fileListPath, relativeFiles.join("\n"))

  const proc = Bun.spawnSync(
    ["tar", "czf", tarballPath, "-C", projectDir, "-T", fileListPath],
    { stderr: "pipe" },
  )

  if (proc.exitCode !== 0) {
    throw new Error("Failed to package project. Check file permissions and try again.")
  }

  const tarball = readFileSync(tarballPath)

  // Cleanup
  const { rmSync } = await import("node:fs")
  rmSync(tmpDir, { recursive: true, force: true })

  return new Uint8Array(tarball)
}
