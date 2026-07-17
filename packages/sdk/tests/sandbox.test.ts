import { afterEach, describe, expect, it, vi } from "vitest"

import { ValidationError } from "../src/errors.js"
import { Sandbox } from "../src/Sandbox.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 })
}

function errorResponse(
  status: number,
  code = "error",
  message = "boom",
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const baseSandbox = {
  id: "sbx-1",
  name: "my-sandbox",
  status: "active",
  vcpu_count: 2,
  memory_mib: 512,
  access_token: "tok-abc",
  created_at: "2026-01-01T00:00:00.000Z",
  metadata: {},
}

const commonOpts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.superserve.ai",
}

describe("Sandbox#getPreviewUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function makeSandbox(): Promise<Sandbox> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(baseSandbox)),
    )
    return Sandbox.create({ ...commonOpts, name: "my-sandbox" })
  }

  it("builds a preview URL for a port", async () => {
    const sandbox = await makeSandbox()
    expect(sandbox.getPreviewUrl(3000)).toBe(
      "https://3000-sbx-1.sandbox.superserve.ai",
    )
  })

  it("returns distinct URLs for multiple ports", async () => {
    const sandbox = await makeSandbox()
    expect(sandbox.getPreviewUrl(3000)).toBe(
      "https://3000-sbx-1.sandbox.superserve.ai",
    )
    expect(sandbox.getPreviewUrl(8080)).toBe(
      "https://8080-sbx-1.sandbox.superserve.ai",
    )
  })

  it("throws ValidationError for an invalid port", async () => {
    const sandbox = await makeSandbox()
    expect(() => sandbox.getPreviewUrl(80)).toThrow(ValidationError)
  })
})

describe("Sandbox statics", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("Sandbox.create posts to /sandboxes with correct body", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      metadata: { env: "test" },
    })
    expect(sandbox.id).toBe("sbx-1")
    expect(sandbox.status).toBe("active")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes")
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers["X-API-Key"]).toBe("ss_live_test")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ name: "my-sandbox", metadata: { env: "test" } })
  })

  it("Sandbox.create sends auto_delete_seconds when set", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      autoDeleteSeconds: 3600,
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ name: "my-sandbox", auto_delete_seconds: 3600 })
  })

  it("Sandbox.create sends a strict preview policy when requested", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ ...baseSandbox, preview_access: "private" }),
    )
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      previewAccess: "private",
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      name: "my-sandbox",
      preview_access: "private",
    })
    expect(sandbox.previewAccess).toBe("private")
  })

  it("sandbox.update sets and clears auto_delete_seconds", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)
    const sandbox = await Sandbox.create({ ...commonOpts, name: "my-sandbox" })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    const patchMock = globalThis.fetch as ReturnType<typeof vi.fn>

    await sandbox.update({ autoDeleteSeconds: 600 })
    let [url, init] = patchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({
      auto_delete_seconds: 600,
    })

    await sandbox.update({ autoDeleteSeconds: null })
    ;[url, init] = patchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      auto_delete_seconds: null,
    })
  })

  it("sandbox.update sets and clears timeout_seconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(baseSandbox)),
    )
    const sandbox = await Sandbox.create({ ...commonOpts, name: "my-sandbox" })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    const patchMock = globalThis.fetch as ReturnType<typeof vi.fn>

    await sandbox.update({ timeoutSeconds: 900 })
    let [, init] = patchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ timeout_seconds: 900 })

    await sandbox.update({ timeoutSeconds: null })
    ;[, init] = patchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ timeout_seconds: null })
  })

  it("sandbox.update changes preview_access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(baseSandbox)),
    )
    const sandbox = await Sandbox.create({ ...commonOpts, name: "my-sandbox" })

    const patchMock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", patchMock)
    await sandbox.update({ previewAccess: "private" })

    const [, init] = patchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      preview_access: "private",
    })
  })

  it("Sandbox.updateById PATCHes directly without activating", async () => {
    const mock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", mock)

    await Sandbox.updateById("sbx-9", { autoDeleteSeconds: 3600 }, commonOpts)

    expect(mock).toHaveBeenCalledOnce()
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    // The whole point: no /activate call, so a paused sandbox stays paused.
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-9")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({
      auto_delete_seconds: 3600,
    })
  })

  it("Sandbox.create throws when access_token missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ...baseSandbox, access_token: undefined }),
      ),
    )
    await expect(
      Sandbox.create({ ...commonOpts, name: "no-token" }),
    ).rejects.toThrow(/missing access_token/)
  })

  it("Sandbox.connect POSTs /activate and returns instance", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.connect("sbx-1", commonOpts)
    expect(sandbox.id).toBe("sbx-1")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/activate")
    expect(init.method).toBe("POST")
  })

  it("Sandbox.connect throws when access_token missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ...baseSandbox, access_token: undefined }),
      ),
    )
    await expect(Sandbox.connect("sbx-1", commonOpts)).rejects.toThrow(
      /missing access_token/,
    )
  })

  it("Sandbox.list returns an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([baseSandbox, { ...baseSandbox, id: "sbx-2" }]),
      ),
    )

    const list = await Sandbox.list(commonOpts)
    expect(list).toHaveLength(2)
    expect(list[0]?.id).toBe("sbx-1")
    expect(list[1]?.id).toBe("sbx-2")
  })

  it("Sandbox.list appends metadata filters to URL", async () => {
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await Sandbox.list({
      ...commonOpts,
      metadata: { env: "prod", tier: "gold" },
    })
    const [url] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("metadata.env=prod")
    expect(url).toContain("metadata.tier=gold")
  })

  it("Sandbox.killById swallows 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "not_found", "gone")),
    )

    await expect(Sandbox.killById("sbx-1", commonOpts)).resolves.toBeUndefined()
  })

  it("Sandbox.killById propagates non-404 errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(500, "server_error", "boom")),
    )

    await expect(Sandbox.killById("sbx-1", commonOpts)).rejects.toThrow()
  })
})

describe("Sandbox instance methods", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function makeSandbox(): Promise<Sandbox> {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)
    const sandbox = await Sandbox.create({ ...commonOpts, name: "test" })
    vi.unstubAllGlobals()
    return sandbox
  }

  it("sandbox.kill swallows 404", async () => {
    const sandbox = await makeSandbox()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "not_found", "gone")),
    )
    await expect(sandbox.kill()).resolves.toBeUndefined()
  })

  it("sandbox.pause returns void and posts to /pause", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    const result = await sandbox.pause()
    expect(result).toBeUndefined()

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/pause")
    expect(init.method).toBe("POST")
  })

  it("sandbox.attachSecret POSTs /secrets with env_key and secret_name", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () =>
      jsonResponse(
        { env_key: "ANTHROPIC_API_KEY", secret_name: "anthropic-prod" },
        201,
      ),
    )
    vi.stubGlobal("fetch", mock)

    await expect(
      sandbox.attachSecret("ANTHROPIC_API_KEY", "anthropic-prod"),
    ).resolves.toBeUndefined()

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/secrets")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      env_key: "ANTHROPIC_API_KEY",
      secret_name: "anthropic-prod",
    })
  })

  it("sandbox.detachSecret DELETEs /secrets/{envKey}", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    await expect(
      sandbox.detachSecret("ANTHROPIC_API_KEY"),
    ).resolves.toBeUndefined()

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "https://api.superserve.ai/sandboxes/sbx-1/secrets/ANTHROPIC_API_KEY",
    )
    expect(init.method).toBe("DELETE")
  })

  it("sandbox.detachSecret url-encodes the env key", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    await sandbox.detachSecret("A/B")
    const [url] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/secrets/A%2FB")
  })

  it("sandbox.resume rotates access token; files uses it transparently", async () => {
    const sandbox = await makeSandbox()
    const filesBefore = sandbox.files

    // Capture the new token when it flows through to a subsequent files.write
    const resumeMock = vi.fn(async () =>
      jsonResponse({
        id: "sbx-1",
        status: "active",
        access_token: "tok-new",
      }),
    )
    vi.stubGlobal("fetch", resumeMock)

    const result = await sandbox.resume()
    expect(result).toBeUndefined()

    const [url, init] = resumeMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/resume")
    expect(init.method).toBe("POST")

    // Files sub-module is the same stable instance (it reads the token live,
    // so there's no rebuild to swap the token in)
    expect(sandbox.files).toBe(filesBefore)

    // Verify subsequent file ops use the rotated token
    vi.unstubAllGlobals()
    const writeMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", writeMock)
    await sandbox.files.write("/tmp/x", "hi")
    const [, writeInit] = writeMock.mock.calls[0] as [string, RequestInit]
    const headers = writeInit.headers as Record<string, string>
    expect(headers["X-Access-Token"]).toBe("tok-new")
  })

  it("sandbox.resume throws when access_token missing", async () => {
    const sandbox = await makeSandbox()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ id: "sbx-1", status: "active" })),
    )
    await expect(sandbox.resume()).rejects.toThrow(/missing access_token/)
  })

  it("publishes, lists, and unpublishes preview ports", async () => {
    const sandbox = await makeSandbox()
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ port: 3000, token_version: 2 }))
      .mockResolvedValueOnce(
        jsonResponse({
          preview_access: "private",
          ports: [{ port: 3000, token_version: 2 }],
        }),
      )
      .mockResolvedValueOnce(noContentResponse())
    vi.stubGlobal("fetch", mock)

    await expect(sandbox.publishPreviewPort(3000)).resolves.toEqual({
      port: 3000,
      tokenVersion: 2,
    })
    await expect(sandbox.listPreviewPorts()).resolves.toEqual({
      previewAccess: "private",
      ports: [{ port: 3000, tokenVersion: 2 }],
    })
    await expect(sandbox.unpublishPreviewPort(3000)).resolves.toBeUndefined()

    expect((mock.mock.calls[0] as [string])[0]).toMatch(
      /\/sandboxes\/sbx-1\/preview-ports$/,
    )
    expect((mock.mock.calls[2] as [string, RequestInit])[1].method).toBe(
      "DELETE",
    )
  })

  it("mints a header token and a short-lived signed URL", async () => {
    const sandbox = await makeSandbox()
    const response = {
      token: "spv1.token",
      port: 3000,
      header: "X-Superserve-Preview-Token",
      query_param: "superserve_preview_token",
      token_version: 3,
      preview_access: "private",
      expires_at: "2026-01-01T01:00:00Z",
    }
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(response))
      .mockResolvedValueOnce(jsonResponse(response))
    vi.stubGlobal("fetch", mock)

    const token = await sandbox.getPreviewToken(3000, {
      expiresInSeconds: 3600,
    })
    expect(token.header).toBe("X-Superserve-Preview-Token")
    expect(token.tokenVersion).toBe(3)
    const [, tokenInit] = mock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(tokenInit.body as string)).toEqual({
      expires_in_seconds: 3600,
    })

    const signed = await sandbox.getSignedPreviewUrl(3000)
    expect(signed).toBe(
      "https://3000-sbx-1.sandbox.superserve.ai/?superserve_preview_token=spv1.token",
    )
    const [, signedInit] = mock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(signedInit.body as string)).toEqual({
      expires_in_seconds: 60,
    })
  })

  it("rotates one preview port token", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () =>
      jsonResponse({
        token: "spv1.fresh",
        port: 8080,
        header: "X-Superserve-Preview-Token",
        query_param: "superserve_preview_token",
        token_version: 4,
        preview_access: "private",
      }),
    )
    vi.stubGlobal("fetch", mock)

    const token = await sandbox.rotatePreviewToken(8080)
    expect(token.tokenVersion).toBe(4)
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/preview-ports\/8080\/token\/rotate$/)
    expect(init.method).toBe("POST")
  })
})

describe("Sandbox.create fromTemplate / fromSnapshot", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("maps fromTemplate (string) to from_template body", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromTemplate: "superserve/python-3.11",
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_template).toBe("superserve/python-3.11")
  })

  it("extracts name from Template-like instance", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromTemplate: { name: "my-env", id: "t-1" },
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_template).toBe("my-env")
  })

  it("falls back to id when name is undefined", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromTemplate: { id: "t-1" },
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_template).toBe("t-1")
  })

  it("maps fromSnapshot to from_snapshot body", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromSnapshot: "snap-abc",
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_snapshot).toBe("snap-abc")
  })
})

describe("Sandbox concurrent token refresh coalesce", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("two concurrent 401-retries fire only one /activate", async () => {
    let activateCalls = 0
    let execCalls = 0
    const mock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/activate")) {
        activateCalls += 1
        // Slow enough that both concurrent callers race onto the same
        // in-flight promise.
        await new Promise((r) => setTimeout(r, 20))
        return jsonResponse({ ...baseSandbox, access_token: "tok-refreshed" })
      }
      if (url.endsWith("/exec")) {
        execCalls += 1
        if (execCalls <= 2) return errorResponse(401, "auth_failed")
        return jsonResponse({ stdout: "ok", stderr: "", exit_code: 0 })
      }
      return jsonResponse(baseSandbox)
    })
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.connect("sbx-1", commonOpts)
    expect(activateCalls).toBe(1) // baseline: connect() did one

    const [a, b] = await Promise.all([
      sandbox.commands.run("echo a"),
      sandbox.commands.run("echo b"),
    ])

    expect(a.exitCode).toBe(0)
    expect(b.exitCode).toBe(0)
    // Two concurrent 401s → ONE additional /activate (coalesced)
    expect(activateCalls).toBe(2)
    expect(execCalls).toBe(4) // 2 initial 401s + 2 successful retries
  })
})
