import { afterEach, describe, expect, it, vi } from "vitest"

const mockRpc = vi.hoisted(() => vi.fn())
const mockTrackEvent = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mockRpc })),
}))
vi.mock("@/lib/posthog/actions", () => ({ trackEvent: mockTrackEvent }))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    CLOUDFLARE_SIGNUP_OBSERVED: "auth_cloudflare_signup_observed",
    CLOUDFLARE_SIGNUP_OBSERVATION_FAILED:
      "auth_cloudflare_signup_observation_failed",
  },
}))

import { observeCloudflareSignup } from "./signup-observe"

afterEach(() => {
  vi.restoreAllMocks()
  mockRpc.mockReset()
  mockTrackEvent.mockReset()
  delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY
  delete process.env.CLOUDFLARE_SIGNUP_CONFIG_VERSION
  delete process.env.CLOUDFLARE_SIGNUP_CAPABILITIES
})

describe("observeCloudflareSignup", () => {
  it("fails open when disabled", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null })
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await expect(
      observeCloudflareSignup({ signupAttemptId: "a", signupMethod: "email" }),
    ).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it("records flag lookup failures", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("down") })
    await observeCloudflareSignup({
      signupAttemptId: "a",
      signupMethod: "email",
    })
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observation_failed",
      "a",
      expect.objectContaining({
        provider_outcome: "configuration_lookup_failed",
      }),
    )
  })

  it("verifies a Turnstile token and persists Free Siteverify fields", async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
    process.env.CLOUDFLARE_SIGNUP_CONFIG_VERSION = "free-v1"
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          challenge_ts: "2026-09-02T00:00:00Z",
          hostname: "console.superserve.ai",
          action: "signup",
          cdata: "experiment",
          metadata: { ephemeral_id: "enterprise-later" },
        }),
      ),
    )
    await observeCloudflareSignup({
      signupAttemptId: "attempt-1",
      signupMethod: "google",
      turnstileToken: "token-secret",
    })
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "attempt-1",
      expect.objectContaining({
        success: true,
        action: "signup",
        hostname: "console.superserve.ai",
        ephemeral_id: "enterprise-later",
        provider_outcome: "success",
      }),
    )
    expect(JSON.stringify(mockTrackEvent.mock.calls)).not.toContain(
      "token-secret",
    )
    expect(logSpy).toHaveBeenCalledWith(
      "Cloudflare signup observation outcome",
      expect.objectContaining({
        signup_attempt_id: "attempt-1",
        provider_outcome: "success",
        success: true,
        hostname: "console.superserve.ai",
        provider_latency_ms: expect.any(Number),
      }),
    )
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain("token-secret")
  })

  it("records provider rejection and error codes without blocking signup", async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["timeout-or-duplicate"],
        }),
      ),
    )
    await expect(
      observeCloudflareSignup({
        signupAttemptId: "a",
        signupMethod: "email",
        turnstileToken: "t",
      }),
    ).resolves.toBeUndefined()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "a",
      expect.objectContaining({
        provider_outcome: "rejected",
        error_codes: ["timeout-or-duplicate"],
      }),
    )
  })

  it("separates provider/configuration errors from visitor rejection", async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["invalid-input-secret"],
        }),
      ),
    )
    await observeCloudflareSignup({
      signupAttemptId: "a",
      signupMethod: "email",
      turnstileToken: "t",
    })
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "a",
      expect.objectContaining({ provider_outcome: "provider_error" }),
    )
  })
})
