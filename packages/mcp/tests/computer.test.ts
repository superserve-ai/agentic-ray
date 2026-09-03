/** `sandbox_computer` — action lowering, screenshots, and error paths. */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createFakeClient, type FakeClient } from "./fake-client.js"
import { callTool, connect, type ConnectedClient } from "./harness.js"

describe("sandbox_computer (in-memory, fake client)", () => {
  let fake: FakeClient
  let conn: ConnectedClient
  let sandboxId: string

  beforeEach(async () => {
    fake = createFakeClient()
    conn = await connect(fake.client)
    const created = await callTool(conn.client, "sandbox_create", {
      name: "desk",
    })
    sandboxId = created.structured.id as string
  })

  afterEach(async () => {
    await conn.close()
  })

  /** Raw callTool so image content blocks are visible. */
  async function callRaw(args: Record<string, unknown>) {
    return (await conn.client.callTool({
      name: "sandbox_computer",
      arguments: { sandbox_id: sandboxId, ...args },
    })) as {
      content: Array<{ type: string; text?: string; mimeType?: string }>
      structuredContent?: Record<string, unknown>
      isError?: boolean
    }
  }

  it("screenshot returns an image block with dimensions", async () => {
    const res = await callRaw({ action: "screenshot" })
    expect(res.isError).toBeFalsy()
    const image = res.content.find((c) => c.type === "image")
    expect(image?.mimeType).toBe("image/png")
    expect(res.structuredContent).toEqual({ width: 1280, height: 800 })
  })

  it("left_click lowers to one click action and returns a screenshot", async () => {
    const res = await callRaw({ action: "left_click", coordinate: [10, 20] })
    expect(res.isError).toBeFalsy()
    expect(fake.desktopBatches).toEqual([
      [{ type: "click", x: 10, y: 20, button: "left" }],
    ])
    expect(res.content.some((c) => c.type === "image")).toBe(true)
  })

  it("screenshot_after: false skips the trailing screenshot", async () => {
    const res = await callRaw({
      action: "left_click",
      coordinate: [1, 1],
      screenshot_after: false,
    })
    expect(res.content.some((c) => c.type === "image")).toBe(false)
  })

  it("left_click_drag lowers to down-move-up in one batch", async () => {
    await callRaw({
      action: "left_click_drag",
      start_coordinate: [5, 6],
      coordinate: [50, 60],
      screenshot_after: false,
    })
    expect(fake.desktopBatches).toEqual([
      [
        { type: "mouseDown", x: 5, y: 6 },
        { type: "move", x: 50, y: 60 },
        { type: "mouseUp", x: 50, y: 60 },
      ],
    ])
  })

  it("triple_click is three clicks in one batch", async () => {
    await callRaw({
      action: "triple_click",
      coordinate: [7, 8],
      screenshot_after: false,
    })
    expect(fake.desktopBatches[0]).toHaveLength(3)
    expect(fake.desktopBatches[0][0]).toEqual({ type: "click", x: 7, y: 8 })
  })

  it("key and type lower to press and write", async () => {
    await callRaw({ action: "key", text: "ctrl+s", screenshot_after: false })
    await callRaw({ action: "type", text: "hello", screenshot_after: false })
    expect(fake.desktopBatches).toEqual([
      [{ type: "press", key: "ctrl+s" }],
      [{ type: "write", text: "hello" }],
    ])
  })

  it("scroll maps direction to signed deltas, with optional positioning", async () => {
    await callRaw({
      action: "scroll",
      scroll_direction: "up",
      scroll_amount: 5,
      screenshot_after: false,
    })
    expect(fake.desktopBatches[0]).toEqual([{ type: "scroll", dx: 0, dy: -5 }])

    await callRaw({
      action: "scroll",
      scroll_direction: "right",
      coordinate: [100, 200],
      screenshot_after: false,
    })
    expect(fake.desktopBatches[1]).toEqual([
      { type: "move", x: 100, y: 200 },
      { type: "scroll", dx: 3, dy: 0 },
    ])
  })

  it("resize calls through and reports the new size", async () => {
    const res = await callTool(conn.client, "sandbox_computer", {
      sandbox_id: sandboxId,
      action: "resize",
      width: 1024,
      height: 768,
    })
    expect(res.isError).toBe(false)
    expect(fake.resizes).toEqual([{ width: 1024, height: 768 }])
    expect(res.structured).toEqual({ width: 1024, height: 768 })
  })

  it("stream_url returns the viewer URL", async () => {
    const res = await callTool(conn.client, "sandbox_computer", {
      sandbox_id: sandboxId,
      action: "stream_url",
    })
    expect(res.structured.url).toContain("/vnc.html")
  })

  it("wait sleeps locally without touching the sandbox", async () => {
    const res = await callTool(conn.client, "sandbox_computer", {
      sandbox_id: sandboxId,
      action: "wait",
      duration_ms: 10,
    })
    expect(res.structured).toEqual({ waited_ms: 10 })
    expect(fake.desktopBatches).toEqual([])
  })

  it("missing required params is a tool error, not a crash", async () => {
    const res = await callRaw({ action: "left_click" })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("coordinate")
  })

  it("unknown sandbox is a tool error", async () => {
    const res = await callTool(conn.client, "sandbox_computer", {
      sandbox_id: "sbx-missing",
      action: "screenshot",
    })
    expect(res.isError).toBe(true)
  })
})
