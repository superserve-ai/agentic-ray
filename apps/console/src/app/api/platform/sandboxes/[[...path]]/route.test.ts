import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  apiKeyUpsert: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "api_key") {
        return { upsert: mocks.apiKeyUpsert }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  })),
}))
vi.mock("@/lib/admin/permissions", () => ({
  canReadPlatformSandboxes: vi.fn(),
}))
vi.mock("@/lib/api/proxy-secret", () => ({
  getProxySecret: vi.fn(() => "proxy-secret"),
  hashKey: vi.fn((key: string) => `hash:${key}`),
}))

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { canReadPlatformSandboxes } from "@/lib/admin/permissions"
import { createServerClient } from "@/lib/supabase/server"

import { GET, HEAD } from "./route"

type AnyParams = { params: Promise<{ path?: string[] }> }

const mockUser = {
  id: "platform-user-1",
  email: "staff@superserve.ai",
  app_metadata: { permissions: ["platform:sandbox:read"] },
}

const TEAM_ID = "11111111-1111-1111-1111-111111111111"
const TTL_TEAM_ID = "22222222-2222-2222-2222-222222222222"
const CACHE_TEAM_ID = "33333333-3333-3333-3333-333333333333"
const DETAIL_TEAM_ID = "44444444-4444-4444-4444-444444444444"

function req(
  path = `/api/platform/sandboxes?team_id=${TEAM_ID}`,
  method = "GET",
): NextRequest {
  return new NextRequest(new URL(`https://console.test${path}`), {
    method,
    headers: { accept: "application/json" },
  })
}

function params(pathSegments: string[] = []): AnyParams {
  return { params: Promise.resolve({ path: pathSegments }) }
}

describe("api proxy /api/platform/sandboxes", () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    mocks.apiKeyUpsert.mockReset()
    vi.unstubAllEnvs()
    mocks.apiKeyUpsert.mockResolvedValue({ error: null })
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: mockUser } }) },
    } as never)
    vi.mocked(canReadPlatformSandboxes).mockReturnValue(true)
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify([{ id: "sandbox-1" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as never)

    const res = await GET(req(), params())

    expect(res.status).toBe(401)
    expect(mocks.apiKeyUpsert).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns 404 when the user lacks platform access", async () => {
    vi.mocked(canReadPlatformSandboxes).mockReturnValue(false)

    const res = await GET(req(), params())

    expect(res.status).toBe(404)
    expect(mocks.apiKeyUpsert).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("requires team_id", async () => {
    const res = await GET(req("/api/platform/sandboxes"), params())

    expect(res.status).toBe(400)
    expect(mocks.apiKeyUpsert).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("proxies list reads with a target-team platform read key and actor header", async () => {
    const res = await GET(req(), params())

    expect(res.status).toBe(200)
    expect(mocks.apiKeyUpsert).toHaveBeenCalledTimes(1)
    expect(mocks.apiKeyUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        team_id: TEAM_ID,
        name: "__console_platform_sandbox_read__",
        created_by: "platform-user-1",
        revoked_at: null,
      }),
      { onConflict: "key_hash" },
    )
    const upsertRow = mocks.apiKeyUpsert.mock.calls[0][0]
    expect(upsertRow.key_hash).toMatch(/^hash:ss_live_/)
    expect(upsertRow.expires_at).toEqual(expect.any(String))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, fetchInit] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.test.superserve.ai/sandboxes")
    const headers = fetchInit.headers as Record<string, string>
    expect(headers["X-API-Key"]).toMatch(/^ss_live_/)
    expect(headers["X-Actor-User-Id"]).toBe("platform-user-1")
  })

  it("caps platform read key expiry at the impersonation TTL limit", async () => {
    vi.stubEnv("IMPERSONATION_TTL_MINUTES", "99999")

    await GET(req(`/api/platform/sandboxes?team_id=${TTL_TEAM_ID}`), params())

    const upsertRow = mocks.apiKeyUpsert.mock.calls[0][0]
    const expiresAt = new Date(upsertRow.expires_at).getTime()
    expect(expiresAt).toBeGreaterThan(Date.now() + 479 * 60_000)
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 480 * 60_000 + 1000)
  })

  it("reuses the cached platform read key row while the cached expiry is fresh", async () => {
    await GET(req(`/api/platform/sandboxes?team_id=${CACHE_TEAM_ID}`), params())
    await GET(req(`/api/platform/sandboxes?team_id=${CACHE_TEAM_ID}`), params())
    expect(mocks.apiKeyUpsert).toHaveBeenCalledTimes(1)
  })

  it("rejects invalid team_id before creating a platform read key", async () => {
    const res = await GET(
      req("/api/platform/sandboxes?team_id=not-a-uuid"),
      params(),
    )

    expect(res.status).toBe(400)
    expect(mocks.apiKeyUpsert).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("proxies detail reads with encoded ids", async () => {
    await GET(
      req(`/api/platform/sandboxes/sandbox/1?team_id=${DETAIL_TEAM_ID}`),
      params(["sandbox/1"]),
    )

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.test.superserve.ai/sandboxes/sandbox%2F1")
    const upsertRow = mocks.apiKeyUpsert.mock.calls[0][0]
    expect(upsertRow.team_id).toBe(DETAIL_TEAM_ID)
  })

  it("supports HEAD without reading a body", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))

    const res = await HEAD(
      req(`/api/platform/sandboxes?team_id=${TEAM_ID}`, "HEAD"),
      params(),
    )

    expect(res.status).toBe(204)
  })
})
