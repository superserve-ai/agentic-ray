/**
 * API proxy tests — exercises the catch-all that forwards browser requests
 * to the sandbox API. Covers:
 *  - Allowed prefix list vs 404
 *  - X-API-Key injection for authenticated requests
 *  - SKIP_KEY_INJECTION (v1/auth/ — no key, client Authorization preserved)
 *  - Header allowlist: cookie, x-api-key from client are stripped
 *  - 204/205/304 null-body handling
 *  - 401 when not authenticated
 */

import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mocks declared BEFORE the module under test is imported.
vi.mock("@/lib/api/proxy-auth", () => ({
  getApiBaseUrlForUser: vi.fn(),
  getAuthApiKeyForUser: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: vi.fn(),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: (region: string) => ({
    region,
    apiBaseUrl: `https://api-${region}.test`,
  }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))

// Global fetch spy — upstream responses are crafted per test.
const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

// SANDBOX_API_URL is pre-stubbed in src/test/setup.ts; the route reads it at module load.

import { getImpersonationContext } from "@/lib/admin/impersonation"
import {
  getApiBaseUrlForUser,
  getAuthApiKeyForUser,
} from "@/lib/api/proxy-auth"
import { createServerClient } from "@/lib/supabase/server"

import { DELETE, GET, POST, PUT } from "./route"

type AnyParams = { params: Promise<{ path: string[] }> }

function req(
  method: string,
  pathSegments: string[],
  init: { headers?: Record<string, string>; body?: BodyInit } = {},
): NextRequest {
  const url = new URL(`https://console.test/api/${pathSegments.join("/")}`)
  return new NextRequest(url, {
    method,
    headers: init.headers,
    body: init.body,
  })
}

function params(pathSegments: string[]): AnyParams {
  return { params: Promise.resolve({ path: pathSegments }) }
}

describe("api proxy /api/[...path]", () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    } as never)
    vi.mocked(getAuthApiKeyForUser).mockReset()
    vi.mocked(getAuthApiKeyForUser).mockResolvedValue("ss_live_test_key")
    vi.mocked(getApiBaseUrlForUser).mockReset()
    vi.mocked(getApiBaseUrlForUser).mockResolvedValue(
      "https://api.test.superserve.ai",
    )
    vi.mocked(getImpersonationContext).mockReset()
    vi.mocked(getImpersonationContext).mockResolvedValue(null)
  })

  it("returns 404 for a path outside the allowed prefixes", async () => {
    const res = await GET(req("GET", ["unknown"]), params(["unknown"]))
    expect(res.status).toBe(404)
  })

  it("forwards the secrets, providers, activity, and billing summary prefixes", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    for (const path of [
      ["secrets"],
      ["secrets", "my_key"],
      ["providers"],
      ["activity"],
    ]) {
      const res = await GET(req("GET", path), params(path))
      expect(res.status).toBe(200)
    }
    const billingRes = await GET(
      req("GET", ["billing", "summary"]),
      params(["billing", "summary"]),
    )
    expect(billingRes.status).toBe(200)
    expect(billingRes.headers.get("cache-control")).toBe("private, no-store")
    expect(fetchSpy).toHaveBeenCalledTimes(5)
    expect(fetchSpy.mock.calls[4][0]).toBe(
      "https://api.test.superserve.ai/billing/summary",
    )
  })

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(getAuthApiKeyForUser).mockResolvedValue(null)
    const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("injects X-API-Key on authenticated requests to /sandboxes", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: "s1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, fetchInit] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.test.superserve.ai/sandboxes")
    const headers = fetchInit.headers as Headers
    expect(headers.get("x-api-key")).toBe("ss_live_test_key")
  })

  it("forwards query params unchanged", async () => {
    fetchSpy.mockResolvedValue(new Response("[]", { status: 200 }))
    const request = new NextRequest(
      new URL("https://console.test/api/sandboxes?status=active&q=foo"),
      { method: "GET" },
    )
    await GET(request, params(["sandboxes"]))
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      "https://api.test.superserve.ai/sandboxes?status=active&q=foo",
    )
  })

  it("overrides forwarded team_id while impersonating", async () => {
    vi.mocked(getImpersonationContext).mockResolvedValue({
      teamId: "impersonated-team",
      region: "usw",
      teamName: "Impersonated Team",
    })
    fetchSpy.mockResolvedValue(new Response("[]", { status: 200 }))
    const request = new NextRequest(
      new URL("https://console.test/api/templates?team_id=admin-team&owner=me"),
      { method: "GET" },
    )

    await GET(request, params(["templates"]))

    expect(getAuthApiKeyForUser).toHaveBeenCalledWith(
      { id: "u1" },
      {
        teamId: "impersonated-team",
        region: "usw",
        teamName: "Impersonated Team",
      },
    )
    expect(getApiBaseUrlForUser).not.toHaveBeenCalled()
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      "https://api-usw.test/templates?team_id=impersonated-team&owner=me",
    )
    const [, fetchInit] = fetchSpy.mock.calls[0]
    const headers = fetchInit.headers as Headers
    expect(headers.get("x-api-key")).toBe("ss_live_test_key")
  })

  it("blocks writes while impersonating", async () => {
    vi.mocked(getImpersonationContext).mockResolvedValue({
      teamId: "impersonated-team",
      region: "usw",
      teamName: "Impersonated Team",
    })

    const res = await POST(
      req("POST", ["templates"], {
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      params(["templates"]),
    )

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "read_only_impersonation" },
    })
  })

  it("skips X-API-Key injection on /v1/auth/ paths and preserves Authorization", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
    await POST(
      req("POST", ["v1", "auth", "device"], {
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      params(["v1", "auth", "device"]),
    )
    const [, fetchInit] = fetchSpy.mock.calls[0]
    const headers = fetchInit.headers as Headers
    expect(headers.get("x-api-key")).toBeNull()
    expect(headers.get("authorization")).toBe("Bearer user-token")
  })

  it("strips disallowed client-supplied headers (cookie, x-api-key)", async () => {
    fetchSpy.mockResolvedValue(new Response("[]", { status: 200 }))
    await GET(
      req("GET", ["sandboxes"], {
        headers: {
          cookie: "sb-access-token=leaked",
          "x-api-key": "ss_live_attacker",
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
      }),
      params(["sandboxes"]),
    )
    const [, fetchInit] = fetchSpy.mock.calls[0]
    const headers = fetchInit.headers as Headers
    expect(headers.get("cookie")).toBeNull()
    // Our server-side key wins, not the attacker's.
    expect(headers.get("authorization")).toBeNull()
    expect(headers.get("x-api-key")).toBe("ss_live_test_key")
    // Allowlisted header still forwarded.
    expect(headers.get("content-type")).toBe("application/json")
  })

  it("handles 204 No Content without crashing on body", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))
    const res = await DELETE(
      req("DELETE", ["sandboxes", "abc"]),
      params(["sandboxes", "abc"]),
    )
    expect(res.status).toBe(204)
    expect(await res.text()).toBe("")
  })

  it("handles 304 Not Modified without body", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 304 }))
    const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))
    expect(res.status).toBe(304)
  })

  it("forwards request body for non-GET methods", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
    await PUT(
      req("PUT", ["sandboxes", "abc"], {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      }),
      params(["sandboxes", "abc"]),
    )
    const [, fetchInit] = fetchSpy.mock.calls[0]
    expect(fetchInit.method).toBe("PUT")
    const body = fetchInit.body as ArrayBuffer
    expect(body.byteLength).toBeGreaterThan(0)
  })

  it("forwards response status, content-type, and body for normal 200s", async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"id":"abc"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const res = await GET(
      req("GET", ["sandboxes", "abc"]),
      params(["sandboxes", "abc"]),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(await res.json()).toEqual({ id: "abc" })
  })

  it("preserves access_token in sandbox responses", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "abc", access_token: "keep-me" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const res = await GET(
      req("GET", ["sandboxes", "abc"]),
      params(["sandboxes", "abc"]),
    )
    expect((await res.json()).access_token).toBe("keep-me")
  })

  it("redacts access tokens during impersonation", async () => {
    vi.mocked(getImpersonationContext).mockResolvedValue({
      teamId: "impersonated-team",
      region: "usw",
      teamName: "Impersonated Team",
    })
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "abc", access_token: "keep-me" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const res = await GET(
      req("GET", ["sandboxes", "abc"]),
      params(["sandboxes", "abc"]),
    )

    expect((await res.json()).access_token).toBeUndefined()
  })
})
