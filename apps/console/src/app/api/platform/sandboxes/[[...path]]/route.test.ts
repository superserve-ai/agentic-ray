import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))
vi.mock("@/lib/admin/permissions", () => ({
  canReadPlatformSandboxes: vi.fn(),
}))
vi.mock("@/lib/api/proxy-secret", () => ({
  getProxySecret: vi.fn(() => "x".repeat(32)),
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
    vi.unstubAllEnvs()
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
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns 404 when the user lacks platform access", async () => {
    vi.mocked(canReadPlatformSandboxes).mockReturnValue(false)

    const res = await GET(req(), params())

    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("requires team_id", async () => {
    const res = await GET(req("/api/platform/sandboxes"), params())

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("proxies list reads through the internal team sandbox endpoint", async () => {
    const res = await GET(req(), params())

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, fetchInit] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      `https://api.test.superserve.ai/internal/teams/${TEAM_ID}/sandboxes`,
    )
    const headers = fetchInit.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${"x".repeat(32)}`)
    expect(headers["X-Actor-User-Id"]).toBe("platform-user-1")
    expect(headers["X-Internal-Secret"]).toBe("x".repeat(32))
  })

  it("rejects invalid team_id before creating a platform read key", async () => {
    const res = await GET(
      req("/api/platform/sandboxes?team_id=not-a-uuid"),
      params(),
    )

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("proxies detail reads with encoded ids", async () => {
    await GET(
      req(`/api/platform/sandboxes/sandbox/1?team_id=${DETAIL_TEAM_ID}`),
      params(["sandbox/1"]),
    )

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      `https://api.test.superserve.ai/internal/teams/${DETAIL_TEAM_ID}/sandboxes/sandbox%2F1`,
    )
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
