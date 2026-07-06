import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.stubEnv("SANDBOX_INTERNAL_API_TOKEN", "internal-token")

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))
vi.mock("@/lib/admin/permissions", () => ({
  canViewOtherUsersAccount: vi.fn(),
}))

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { canViewOtherUsersAccount } from "@/lib/admin/permissions"
import { createServerClient } from "@/lib/supabase/server"

import { GET, HEAD } from "./route"

type AnyParams = { params: Promise<{ path?: string[] }> }

const mockUser = {
  id: "platform-user-1",
  email: "staff@superserve.ai",
  app_metadata: { permissions: ["platform:teams:read"] },
}

function req(
  path = "/api/platform/sandboxes?team_id=team-1",
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
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: mockUser } }) },
    } as never)
    vi.mocked(canViewOtherUsersAccount).mockReturnValue(true)
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: "sandbox-1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
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
    vi.mocked(canViewOtherUsersAccount).mockReturnValue(false)

    const res = await GET(req(), params())

    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("requires team_id", async () => {
    const res = await GET(req("/api/platform/sandboxes"), params())

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("proxies list reads with the internal token and actor header", async () => {
    const res = await GET(req(), params())

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, fetchInit] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      "https://api.test.superserve.ai/internal/teams/team-1/sandboxes",
    )
    const headers = fetchInit.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer internal-token")
    expect(headers["X-Actor-User-Id"]).toBe("platform-user-1")
  })

  it("proxies detail reads with encoded ids", async () => {
    await GET(
      req("/api/platform/sandboxes/sandbox/1?team_id=team 1"),
      params(["sandbox/1"]),
    )

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      "https://api.test.superserve.ai/internal/teams/team%201/sandboxes/sandbox%2F1",
    )
  })

  it("supports HEAD without reading a body", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))

    const res = await HEAD(
      req("/api/platform/sandboxes?team_id=team-1", "HEAD"),
      params(),
    )

    expect(res.status).toBe(204)
  })
})
