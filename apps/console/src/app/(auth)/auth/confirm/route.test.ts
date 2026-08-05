import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockCreateServerClient = vi.fn()
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}))

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

vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    SIGN_UP_COMPLETED: "auth_sign_up_completed",
  },
}))

import { GET } from "./route"

describe("auth confirm route", () => {
  const mockVerifyOtp = vi.fn()
  const mockGetUser = vi.fn()
  let capturedSetAll:
    | ((
        cookies: Array<{
          name: string
          value: string
          options?: Record<string, unknown>
        }>,
      ) => void)
    | null = null

  beforeEach(() => {
    mockCreateServerClient.mockReset()
    mockCreateServerClient.mockImplementation(
      (
        _url: string,
        _anonKey: string,
        options: {
          cookies: {
            setAll: (
              cookies: Array<{
                name: string
                value: string
                options?: Record<string, unknown>
              }>,
            ) => void
          }
        },
      ) => {
        capturedSetAll = options.cookies.setAll
        return {
          auth: {
            verifyOtp: mockVerifyOtp,
            getUser: mockGetUser,
          },
        }
      },
    )
    mockVerifyOtp.mockReset()
    mockGetUser.mockReset()
    mockNotifySlackOfNewUser.mockReset().mockResolvedValue(undefined)
    mockSendWelcomeEmail.mockReset().mockResolvedValue(undefined)
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    capturedSetAll = null
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key"
    process.env.NEXT_PUBLIC_APP_URL = "https://console.superserve.ai"
    process.env.VERCEL_ENV = "production"
  })

  it("verifies the email token, persists cookies, and redirects to sandboxes", async () => {
    mockVerifyOtp.mockImplementation(async () => {
      capturedSetAll?.([
        {
          name: "sb-access-token",
          value: "access-token",
          options: { path: "/" },
        },
        {
          name: "sb-refresh-token",
          value: "refresh-token",
          options: { path: "/" },
        },
      ])
      return { error: null }
    })
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          created_at: new Date().toISOString(),
          email: "user@test.com",
          user_metadata: { full_name: "Test User" },
          app_metadata: { provider: "email" },
        },
      },
    })

    const request = new NextRequest(
      "https://console.superserve.ai/auth/confirm?token_hash=abc123&type=signup",
    )
    const response = await GET(request)

    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-key",
      expect.objectContaining({ cookies: expect.any(Object) }),
    )
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: "abc123",
      type: "signup",
    })
    expect(mockGetUser).toHaveBeenCalled()
    expect(mockNotifySlackOfNewUser).toHaveBeenCalled()
    expect(mockSendWelcomeEmail).toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_sign_up_completed",
      expect.any(String),
      expect.objectContaining({
        provider: "email",
        email: "user@test.com",
        is_new_user: true,
      }),
    )
    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(response.cookies.get("sb-access-token")?.value).toBe("access-token")
    expect(response.cookies.get("sb-refresh-token")?.value).toBe(
      "refresh-token",
    )
  })

  it("redirects blocked confirmations to the auth error page", async () => {
    mockVerifyOtp.mockResolvedValue({
      error: { message: "database error saving new user" },
    })

    const request = new NextRequest(
      "https://console.superserve.ai/auth/confirm?token_hash=abc123&type=signup",
    )
    const response = await GET(request)

    expect(response.headers.get("location")).toContain(
      "/auth/auth-code-error?reason=signup_blocked",
    )
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it("redirects recovery links to the reset-password page", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null })

    const request = new NextRequest(
      "https://console.superserve.ai/auth/confirm?token_hash=abc123&type=recovery",
    )
    const response = await GET(request)

    expect(response.headers.get("location")).toContain("/auth/reset-password")
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})
