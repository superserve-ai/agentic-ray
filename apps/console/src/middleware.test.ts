/**
 * Middleware tests — route protection, public bypass, cookie refresh
 * preservation on redirect.
 *
 * The middleware delegates session lookup to `createMiddlewareClient` from
 * `@/lib/supabase/middleware`, which we mock. We assert:
 *   1. Unauthenticated users on protected routes get a redirect to
 *      /auth/signin?next=<current path>, with cookies from
 *      client.response copied onto the redirect (regression guard for the
 *      "dropped refreshed cookies on redirect" bug).
 *   2. Unauthenticated users on public routes are allowed through.
 *   3. Authenticated users are allowed through.
 *   4. When the Supabase client is absent (missing env), the raw response
 *      is returned.
 */

import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mock createMiddlewareClient ---

type MockClient = {
  supabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
  } | null
  response: NextResponse
}

let mockClient: MockClient

vi.mock("@/lib/supabase/middleware", () => ({
  createMiddlewareClient: () => mockClient,
  matchesRoute: (pathname: string, routes: string[]) =>
    routes.some((r) => pathname === r || pathname.startsWith(`${r}/`)),
}))

// Import AFTER mocks so the module picks them up.
import { middleware } from "./middleware"

function buildRequest(path: string): NextRequest {
  return new NextRequest(new URL(`https://console.superserve.ai${path}`))
}

function buildResponse(
  cookies: Array<{ name: string; value: string }> = [],
): NextResponse {
  const res = NextResponse.next()
  for (const { name, value } of cookies) {
    res.cookies.set(name, value)
  }
  return res
}

describe("middleware", () => {
  beforeEach(() => {
    mockClient = {
      supabase: {
        auth: {
          getUser: vi
            .fn()
            .mockResolvedValue({ data: { user: null }, error: null }),
        },
      },
      response: buildResponse(),
    }
  })

  it("returns the raw response when supabase client is missing", async () => {
    mockClient.supabase = null
    const res = await middleware(buildRequest("/sandboxes"))
    // With no supabase, we should just pass client.response through.
    expect(res).toBe(mockClient.response)
  })

  it("redirects unauthenticated users on protected routes with next param", async () => {
    const res = await middleware(buildRequest("/sandboxes/abc"))

    // Should be a redirect
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)

    const location = res.headers.get("location")
    expect(location).toContain("/auth/signin")
    expect(location).toContain("next=%2Fsandboxes%2Fabc")
  })

  it("preserves refreshed auth cookies from client.response on redirect", async () => {
    // Simulate Supabase writing refreshed auth cookies onto client.response
    // (which is what setAll does when getUser() refreshes the token).
    mockClient.response = buildResponse([
      { name: "sb-access-token", value: "refreshed-token" },
      { name: "sb-refresh-token", value: "refreshed-refresh" },
    ])

    const res = await middleware(buildRequest("/sandboxes"))

    // The redirect must carry those cookies forward.
    const accessCookie = res.cookies.get("sb-access-token")
    const refreshCookie = res.cookies.get("sb-refresh-token")
    expect(accessCookie?.value).toBe("refreshed-token")
    expect(refreshCookie?.value).toBe("refreshed-refresh")
  })

  it("checks the session but lets unauthenticated users through on public routes", async () => {
    for (const path of [
      "/auth/signin",
      "/auth/signup",
      "/auth/forgot-password",
      "/auth/confirm",
      "/auth/callback",
      "/device",
    ]) {
      mockClient.supabase!.auth.getUser.mockClear()
      const res = await middleware(buildRequest(path))
      // Not a redirect — we should get the raw client.response back.
      expect(res).toBe(mockClient.response)
      expect(mockClient.supabase!.auth.getUser).toHaveBeenCalledTimes(1)
    }
  })

  it("lets authenticated users through on protected routes", async () => {
    mockClient.supabase!.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "u@e.com" } },
      error: null,
    })

    const res = await middleware(buildRequest("/sandboxes"))
    expect(res).toBe(mockClient.response)
  })
})
