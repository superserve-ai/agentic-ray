import { Sandbox } from "@superserve/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

describe.skipIf(!hasCredentials())("files", () => {
  const name = `sdk-e2e-files-${RUN_ID}`
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

  it("round-trips a small file through write → readText", async () => {
    const content = `hello-from-e2e-${RUN_ID}\n`

    await sandbox.files.write("/home/user/e2e-probe.txt", content)
    const downloaded = await sandbox.files.readText("/home/user/e2e-probe.txt")

    expect(downloaded).toBe(content)
  })
})
