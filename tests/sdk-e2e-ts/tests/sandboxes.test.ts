import type { SandboxInfo } from "@superserve/sdk"
import { Sandbox } from "@superserve/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

describe.skipIf(!hasCredentials())("sandboxes", () => {
  const name = `sdk-e2e-sandbox-${RUN_ID}`
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

  it("getInfo returns the created sandbox", async () => {
    const info = await sandbox.getInfo()
    expect(info.id).toBe(sandbox.id)
    expect(info.name).toBe(name)
    expect(info.status).toBe("active")
  })

  it("list includes our sandbox", async () => {
    const list = await Sandbox.list(opts)
    const ids = list.map((s: SandboxInfo) => s.id)
    expect(ids).toContain(sandbox.id)
  })

  it("update writes back metadata", async () => {
    const metadata = { env: "test", "run-id": RUN_ID }
    await sandbox.update({ metadata })
    const info = await sandbox.getInfo()
    expect(info.metadata).toMatchObject(metadata)
  })

  it("pause → resume lifecycle", async () => {
    await sandbox.pause()
    expect((await sandbox.getInfo()).status).toBe("paused")

    await sandbox.resume()
    expect((await sandbox.getInfo()).status).toBe("active")
  })
})
