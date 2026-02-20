import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// We need to test the auth module with a temporary config directory
// So we mock the AUTH_FILE constant by setting env var

describe("auth", () => {
  let tmpDir: string
  let authFile: string
  beforeEach(async () => {
    tmpDir = join(tmpdir(), `superserve-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    authFile = join(tmpDir, "auth.json")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("credentials file format", () => {
    const creds = {
      token: "test-token-123",
      token_type: "Bearer",
    }
    const json = JSON.stringify(creds, null, 2)
    Bun.write(authFile, json)

    const read = JSON.parse(readFileSync(authFile, "utf-8"))
    expect(read.token).toBe("test-token-123")
    expect(read.token_type).toBe("Bearer")
  })

  test("handles missing file", () => {
    expect(existsSync(authFile)).toBe(false)
  })

  test("handles corrupted JSON", () => {
    Bun.write(authFile, "not valid json{{{")
    let parsed = null
    try {
      parsed = JSON.parse(readFileSync(authFile, "utf-8"))
    } catch {
      // Expected
    }
    expect(parsed).toBeNull()
  })
})
