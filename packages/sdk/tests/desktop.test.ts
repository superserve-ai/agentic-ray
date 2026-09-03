import { afterEach, describe, expect, it, vi } from "vitest"

import { Desktop, type DesktopDeps } from "../src/desktop.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const sandboxId = "sbx-1"
const sandboxHost = "sandbox.example.com"
const rpcBase = `https://boxd-${sandboxId}.${sandboxHost}/superserve.boxd.v1.DesktopService`

function makeDeps(overrides: Partial<DesktopDeps> = {}): DesktopDeps {
  let token = "tok-initial"
  return {
    sandboxId,
    sandboxHost,
    getAccessToken: () => token,
    refreshActivate: async () => {
      token = "tok-refreshed"
      return token
    },
    publishStreamPort: async () => {},
    streamBaseUrl: () => `https://6080-${sandboxId}.${sandboxHost}`,
    ...overrides,
  }
}

/** Stub fetch, run `fn`, and return the recorded [url, parsed body] calls. */
async function recordCalls(
  responses: Response[],
  fn: (desktop: Desktop) => Promise<unknown>,
): Promise<Array<{ url: string; body: unknown; headers: Headers }>> {
  const calls: Array<{ url: string; body: unknown; headers: Headers }> = []
  let i = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init.headers),
      })
      return responses[Math.min(i++, responses.length - 1)]
    }),
  )
  await fn(new Desktop(makeDeps()))
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Desktop.screenshot", () => {
  it("decodes base64 PNG and dimensions", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const image = btoa(String.fromCharCode(...png))
    let shot: Awaited<ReturnType<Desktop["screenshot"]>> | undefined
    const calls = await recordCalls(
      [jsonResponse({ image, width: 1280, height: 800 })],
      async (d) => {
        shot = await d.screenshot()
      },
    )
    expect(calls[0].url).toBe(`${rpcBase}/Screenshot`)
    expect(calls[0].headers.get("X-Access-Token")).toBe("tok-initial")
    expect(shot!.data).toEqual(png)
    expect(shot!.width).toBe(1280)
    expect(shot!.height).toBe(800)
  })

  it("throws when the response has no image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ width: 1, height: 1 })),
    )
    await expect(new Desktop(makeDeps()).screenshot()).rejects.toThrow(
      /missing image/,
    )
  })
})

describe("Desktop pointer actions", () => {
  it("click is a single RPC carrying move+click", async () => {
    const calls = await recordCalls([jsonResponse({})], (d) => d.click(10, 20))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${rpcBase}/SendPointer`)
    expect(calls[0].body).toEqual({
      x: 10,
      y: 20,
      button: "POINTER_BUTTON_LEFT",
      action: "POINTER_ACTION_CLICK",
    })
  })

  it("treats 0 as a valid coordinate", async () => {
    const calls = await recordCalls([jsonResponse({})], (d) => d.click(0, 300))
    expect(calls[0].body).toMatchObject({ x: 0, y: 300 })
  })

  it("rejects negative and non-integer coordinates without a request", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const desktop = new Desktop(makeDeps())
    await expect(desktop.click(-1, 5)).rejects.toThrow(/Invalid coordinates/)
    await expect(desktop.moveMouse(1.5, 5)).rejects.toThrow(
      /Invalid coordinates/,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("drag is one atomic batch: down, move, up", async () => {
    const calls = await recordCalls([jsonResponse({ executed: 3 })], (d) =>
      d.drag([1, 2], [30, 40]),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${rpcBase}/SendActions`)
    const actions = (calls[0].body as { actions: unknown[] }).actions
    expect(actions).toEqual([
      {
        pointer: {
          x: 1,
          y: 2,
          button: "POINTER_BUTTON_LEFT",
          action: "POINTER_ACTION_DOWN",
        },
      },
      {
        pointer: {
          x: 30,
          y: 40,
          button: "POINTER_BUTTON_LEFT",
          action: "POINTER_ACTION_MOVE",
        },
      },
      {
        pointer: {
          x: 30,
          y: 40,
          button: "POINTER_BUTTON_LEFT",
          action: "POINTER_ACTION_UP",
        },
      },
    ])
  })
})

describe("Desktop keyboard", () => {
  it("write sends literal text", async () => {
    const calls = await recordCalls([jsonResponse({})], (d) =>
      d.write("hello world"),
    )
    expect(calls[0].url).toBe(`${rpcBase}/SendKey`)
    expect(calls[0].body).toEqual({ text: "hello world" })
  })

  it("write with empty text is a no-op", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    await new Desktop(makeDeps()).write("")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("press maps friendly names and splits chords", async () => {
    const calls = await recordCalls(
      [jsonResponse({}), jsonResponse({}), jsonResponse({})],
      async (d) => {
        await d.press("enter")
        await d.press("ctrl+c")
        await d.press(["cmd", "shift", "p"])
      },
    )
    expect(calls[0].body).toEqual({ key: "Return", modifiers: [] })
    expect(calls[1].body).toEqual({ key: "c", modifiers: ["ctrl"] })
    expect(calls[2].body).toEqual({ key: "p", modifiers: ["super", "shift"] })
  })

  it("press passes unknown keysyms through verbatim", async () => {
    const calls = await recordCalls([jsonResponse({})], (d) => d.press("F5"))
    expect(calls[0].body).toEqual({ key: "F5", modifiers: [] })
  })
})

describe("Desktop.scroll / resize / actions", () => {
  it("scroll sends both axes", async () => {
    const calls = await recordCalls([jsonResponse({})], (d) =>
      d.scroll({ dx: -2, dy: 5 }),
    )
    expect(calls[0].url).toBe(`${rpcBase}/Scroll`)
    expect(calls[0].body).toEqual({ dx: -2, dy: 5 })
  })

  it("resize posts dimensions", async () => {
    const calls = await recordCalls([jsonResponse({})], (d) =>
      d.resize(1024, 768),
    )
    expect(calls[0].url).toBe(`${rpcBase}/Resize`)
    expect(calls[0].body).toEqual({ width: 1024, height: 768 })
  })

  it("actions maps every action type into one batch", async () => {
    const calls = await recordCalls([jsonResponse({ executed: 3 })], (d) =>
      d.actions([
        { type: "click", x: 5, y: 6, button: "right" },
        { type: "write", text: "hi" },
        { type: "scroll", dy: 3 },
      ]),
    )
    expect(calls).toHaveLength(1)
    const actions = (calls[0].body as { actions: unknown[] }).actions
    expect(actions).toEqual([
      {
        pointer: {
          x: 5,
          y: 6,
          button: "POINTER_BUTTON_RIGHT",
          action: "POINTER_ACTION_CLICK",
        },
      },
      { key: { text: "hi" } },
      { scroll: { dx: 0, dy: 3 } },
    ])
  })

  it("empty actions batch is a no-op", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    await new Desktop(makeDeps()).actions([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("an invalid action anywhere rejects the batch before any request", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    await expect(
      new Desktop(makeDeps()).actions([
        { type: "click", x: 1, y: 1 },
        { type: "move", x: -4, y: 2 },
      ]),
    ).rejects.toThrow(/Invalid coordinates/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("Desktop.getStreamUrl", () => {
  it("publishes the port and returns the noVNC URL", async () => {
    const publish = vi.fn(async () => {})
    const desktop = new Desktop(makeDeps({ publishStreamPort: publish }))
    const url = await desktop.getStreamUrl()
    expect(publish).toHaveBeenCalledOnce()
    expect(url).toBe(
      `https://6080-${sandboxId}.${sandboxHost}/vnc.html?autoconnect=1&resize=scale`,
    )
  })

  it("appends view_only when requested", async () => {
    const desktop = new Desktop(makeDeps())
    const url = await desktop.getStreamUrl({ viewOnly: true })
    expect(url).toContain("view_only=1")
  })
})

describe("Desktop token retry", () => {
  it("activates and retries once on a stale token", async () => {
    const tokens: Array<string | null> = []
    let call = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        tokens.push(new Headers(init.headers).get("X-Access-Token"))
        call++
        if (call === 1) {
          return jsonResponse({ code: "unauthenticated" }, 401)
        }
        return jsonResponse({})
      }),
    )
    await new Desktop(makeDeps()).click(1, 1)
    expect(tokens).toEqual(["tok-initial", "tok-refreshed"])
  })
})
