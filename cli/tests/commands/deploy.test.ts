import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("deploy - config validation", () => {
  let tmpDir: string

  function setup(yamlContent: string) {
    tmpDir = join(tmpdir(), `superserve-deploy-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(join(tmpDir, "superserve.yaml"), yamlContent)
    return tmpDir
  }

  function cleanup() {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  }

  test("valid config loads successfully", async () => {
    const dir = setup("name: test-agent\ncommand: python main.py\n")
    try {
      const { loadProjectConfig } = await import("../../src/config/project")
      const config = loadProjectConfig(dir)
      expect(config.name).toBe("test-agent")
      expect(config.command).toBe("python main.py")
    } finally {
      cleanup()
    }
  })

  test("missing name throws", async () => {
    const dir = setup("command: python main.py\n")
    try {
      const { loadProjectConfig } = await import("../../src/config/project")
      expect(() => loadProjectConfig(dir)).toThrow("name")
    } finally {
      cleanup()
    }
  })

  test("missing command throws", async () => {
    const dir = setup("name: test-agent\n")
    try {
      const { loadProjectConfig } = await import("../../src/config/project")
      expect(() => loadProjectConfig(dir)).toThrow("command")
    } finally {
      cleanup()
    }
  })

  test("missing file throws", async () => {
    const dir = join(tmpdir(), `superserve-empty-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const { loadProjectConfig } = await import("../../src/config/project")
      expect(() => loadProjectConfig(dir)).toThrow("not found")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("config with secrets and ignore", async () => {
    const dir = setup(
      "name: test\ncommand: python main.py\nsecrets:\n  - API_KEY\nignore:\n  - .venv\n",
    )
    try {
      const { loadProjectConfig } = await import("../../src/config/project")
      const config = loadProjectConfig(dir)
      expect(config.secrets).toEqual(["API_KEY"])
      expect(config.ignore).toEqual([".venv"])
    } finally {
      cleanup()
    }
  })
})
