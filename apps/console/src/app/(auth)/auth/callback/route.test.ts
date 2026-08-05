import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockCreateServerClientFromLib = vi.fn()

const mockNotifySlackOfNewUser = vi.fn().mockResolvedValue(undefined)
vi.mock("@/app/(auth)/auth/signin/action", () => ({
  notifySlackOfNewUser: (...args: unknown[]) =>
    mockNotifySlackOfNewUser(...args),
}))

const mockSendWelcomeEmail = vi.fn().mockResolvedValue(undefined)
vi.mock("@/app/(auth)/auth/signup/action", () => ({
  sendWelcomeEmail: (...args: unknown[]) => mockSendWelcomeEmail(...args),
}))

const mockTrackEvent = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: (...args: unknown[]) =>
    mockCreateServerClientFromLib(...args),
}))

import { GET } from "./route"

describe("auth callback route", () => {
  const mockExchangeCodeForSession = vi.fn()
  const mockGetUser = vi.fn()

  beforeEach(() => {
    mockCreateServerClientFromLib.mockReset()
    mockCreateServerClientFromLib.mockReturnValue({
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
        getUser: mockGetUser,
      },
    })
    mockExchangeCodeForSession.mockReset()
    mockGetUser.mockReset()
    mockNotifySlackOfNewUser.mockReset().mockResolvedValue(undefined)
    mockSendWelcomeEmail.mockReset().mockResolvedValue(undefined)
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    process.env.NEXT_PUBLIC_APP_URL = "https://console.superserve.ai"
    process.env.VERCEL_ENV = "production"
  })

  it("redirects token_hash confirmations to the dedicated confirm route", async () => {
    const request = new NextRequest(
      "https://console.superserve.ai/auth/callback?token_hash=abc123&type=signup&next=/sandboxes",
    )
    const response = await GET(request)

    expect(response.headers.get("location")).toContain(
      "/auth/confirm?token_hash=abc123&type=signup&next=%2Fsandboxes",
    )
    expect(mockCreateServerClientFromLib).not.toHaveBeenCalled()
  })

  it("falls back to the auth error page when no auth params are present", async () => {
    const request = new NextRequest(
      "https://console.superserve.ai/auth/callback",
    )
    const response = await GET(request)

    expect(response.headers.get("location")).toContain("/auth/auth-code-error")
  })

  it("exchanges OAuth codes and redirects authenticated users", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          created_at: "2026-08-05T00:00:00.000Z",
          email: "user@test.com",
          user_metadata: { full_name: "Test User" },
          app_metadata: { provider: "google" },
          id: "user-1",
        },
      },
    })

    const request = new NextRequest(
      "https://console.superserve.ai/auth/callback?code=oauth-code&next=/sandboxes",
    )
    const response = await GET(request)

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("oauth-code")
    expect(mockGetUser).toHaveBeenCalled()
    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockTrackEvent).toHaveBeenCalled()
  })

  it("preserves trusted absolute redirects for OAuth callbacks", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          created_at: "2026-08-05T00:00:00.000Z",
          email: "user@test.com",
          user_metadata: { full_name: "Test User" },
          app_metadata: { provider: "google" },
          id: "user-1",
        },
      },
    })

    const request = new NextRequest(
      "https://console.superserve.ai/auth/callback?code=oauth-code&next=https://www.superserve.ai/device",
    )
    const response = await GET(request)

    expect(response.headers.get("location")).toBe(
      "https://www.superserve.ai/device",
    )
  })
})
