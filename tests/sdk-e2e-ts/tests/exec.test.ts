import { Sandbox } from "@superserve/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

describe.skipIf(!hasCredentials())("exec", () => {
  const name = `sdk-e2e-exec-${RUN_ID}`
  let sandbox: Sandbox
  const opts = hasCredentials()
    ? connectionOptions()
    : { apiKey: "", baseUrl: "" }

  beforeAll(async () => {
    sandbox = await Sandbox.create({ name, ...opts })
  })

  afterAll(async () => {
    if (!sandbox?.id) return
    try {
      await sandbox.kill()
    } catch (err) {
      console.error(`Cleanup failed for sandbox ${sandbox.id}:`, err)
    }
  })

  it("runs a sync command and returns stdout + exit code", async () => {
    const result = await sandbox.commands.run("echo hello-from-e2e")
    expect(result.stdout).toContain("hello-from-e2e")
    expect(result.exitCode).toBe(0)
  })

  it("returns a non-zero exit code for failing commands", async () => {
    const result = await sandbox.commands.run("exit 42")
    expect(result.exitCode).toBe(42)
  })

  it("streams output via callbacks", async () => {
    const stdoutChunks: string[] = []

    const result = await sandbox.commands.run(
      "for i in 1 2 3; do echo line-$i; sleep 0.1; done",
      {
        onStdout: (data) => stdoutChunks.push(data),
      },
    )

    const combined = stdoutChunks.join("")
    expect(combined).toContain("line-1")
    expect(combined).toContain("line-2")
    expect(combined).toContain("line-3")
    expect(result.exitCode).toBe(0)
  })
})
