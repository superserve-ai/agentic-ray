import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock dependencies before importing the action
const mockGenerateLink = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        generateLink: mockGenerateLink,
      },
    },
  }),
}))

const mockSendEmail = vi.fn()
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

vi.mock("@/lib/email/templates/confirmation", () => ({
  ConfirmationEmail: (props: { confirmationUrl: string }) =>
    `ConfirmationEmail:${props.confirmationUrl}`,
}))

vi.mock("@/lib/email/templates/welcome", () => ({
  WelcomeEmail: (props: { name: string; dashboardUrl: string }) =>
    `WelcomeEmail:${props.name}`,
}))

const mockSlack = vi.fn().mockResolvedValue(undefined)
vi.mock("@/app/(auth)/auth/signin/action", () => ({
  notifySlackOfNewUser: (...args: unknown[]) => mockSlack(...args),
}))

const mockVerifyRecaptcha = vi.fn()
vi.mock("@/lib/recaptcha/verify", () => ({
  verifyRecaptcha: (...args: unknown[]) => mockVerifyRecaptcha(...args),
}))

const mockIssueGoogleSignupProof = vi.fn()
vi.mock("@/lib/auth/google-signup-proof", () => ({
  issueGoogleSignupProof: () => mockIssueGoogleSignupProof(),
}))

const mockObserveCloudflareSignup = vi.fn()
vi.mock("@/lib/cloudflare/signup-observe", () => ({
  observeCloudflareSignup: (...args: unknown[]) =>
    mockObserveCloudflareSignup(...args),
}))

const mockTrackEvent = vi.fn()
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

const mockObserveFingerprintSignup = vi.fn()
vi.mock("@/lib/fingerprint/observe", () => ({
  observeFingerprintSignup: (...args: unknown[]) =>
    mockObserveFingerprintSignup(...args),
}))

vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    GOOGLE_SIGNUP_CAPTCHA_FAILED: "auth_google_signup_captcha_failed",
    GOOGLE_SIGNUP_CAPTCHA_VERIFIED: "auth_google_signup_captcha_verified",
    SIGNUP_ATTEMPT_ASSOCIATED: "auth_signup_attempt_associated",
    SIGNUP_RECAPTCHA_OBSERVED: "auth_signup_recaptcha_observed",
  },
}))

let fingerprintSignupEventId: string | undefined
const mockFingerprintCookieDelete = vi.fn()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      fingerprintSignupEventId === undefined
        ? undefined
        : { name, value: fingerprintSignupEventId },
    delete: (name: string) => {
      if (name === "fingerprint_signup_event_id") {
        fingerprintSignupEventId = undefined
      }
      mockFingerprintCookieDelete(name)
    },
  }),
}))

vi.mock("next/server", () => ({
  after: (callback: () => void | Promise<void>) => callback(),
}))

import { beginGoogleSignup, signUpWithEmail } from "./action"

// verifyRecaptcha reads these at call time (not module load), so these
// tests — which assert unconfigured (fail-open) behavior and never pass a
// token — need them explicitly cleared rather than relying on the ambient
// environment. A dev/CI env with reCAPTCHA configured would otherwise
// reject every one of these as a missing token.
const ORIGINAL_RECAPTCHA_ENV = {
  RECAPTCHA_API_KEY: process.env.RECAPTCHA_API_KEY,
  RECAPTCHA_PROJECT_ID: process.env.RECAPTCHA_PROJECT_ID,
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
}

describe("signUpWithEmail", () => {
  beforeEach(() => {
    mockGenerateLink.mockReset()
    mockSendEmail.mockReset()
    mockSlack.mockReset().mockResolvedValue(undefined)
    mockVerifyRecaptcha.mockReset().mockResolvedValue({ verified: true })
    mockIssueGoogleSignupProof.mockReset().mockResolvedValue(undefined)
    mockObserveCloudflareSignup.mockReset().mockResolvedValue(undefined)
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    mockObserveFingerprintSignup.mockReset().mockResolvedValue(undefined)
    mockFingerprintCookieDelete.mockReset()
    fingerprintSignupEventId = undefined
    delete process.env.RECAPTCHA_API_KEY
    delete process.env.RECAPTCHA_PROJECT_ID
    delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
  })

  afterEach(() => {
    for (const [name, value] of Object.entries(ORIGINAL_RECAPTCHA_ENV)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it("returns error for invalid email", async () => {
    const result = await signUpWithEmail(
      "not-an-email",
      "password123",
      "Test User",
    )
    expect(result).toEqual({
      success: false,
      error: "Invalid email address.",
    })
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("returns error for short password", async () => {
    const result = await signUpWithEmail("user@test.com", "short", "Test User")
    expect(result).toEqual({
      success: false,
      error: "Password must be at least 8 characters.",
    })
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("returns error for empty name", async () => {
    const result = await signUpWithEmail("user@test.com", "password123", "")
    expect(result).toEqual({
      success: false,
      error: "Name is required.",
    })
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("returns success and sends confirmation email on valid signup", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "abc123" } },
      error: null,
    })
    mockSendEmail.mockResolvedValue({ success: true })

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({ success: true })
    expect(mockGenerateLink).toHaveBeenCalledWith({
      type: "signup",
      email: "user@test.com",
      password: "password123",
      options: {
        data: { full_name: "Test User" },
        redirectTo: expect.stringContaining("/auth/callback"),
      },
    })
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@test.com",
        subject: "Confirm your Superserve account",
      }),
    )
  })

  it("retains the fingerprint cookie across repeated attempts and schedules observe-only telemetry", async () => {
    fingerprintSignupEventId = encodeURIComponent("event-123")
    mockGenerateLink.mockResolvedValue({
      data: {
        user: { id: "user-1" },
        properties: { hashed_token: "abc123" },
      },
      error: null,
    })
    mockSendEmail.mockResolvedValue({ success: true })

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )
    const secondResult = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({ success: true })
    expect(secondResult).toEqual({ success: true })
    expect(mockFingerprintCookieDelete).not.toHaveBeenCalled()
    expect(fingerprintSignupEventId).toBe("event-123")
    expect(mockObserveFingerprintSignup).toHaveBeenNthCalledWith(1, {
      eventId: "event-123",
      signupMethod: "email",
      userId: "user-1",
      signupAttemptId: expect.any(String),
    })
    expect(mockObserveFingerprintSignup).toHaveBeenNthCalledWith(2, {
      eventId: "event-123",
      signupMethod: "email",
      userId: "user-1",
      signupAttemptId: expect.any(String),
    })
    expect(mockObserveCloudflareSignup).toHaveBeenCalledTimes(2)
    const cloudflareCalls = mockObserveCloudflareSignup.mock.calls.map(
      ([args]) =>
        args as {
          signupAttemptId: string
          signupMethod: "email" | "google"
          userId?: string | null
          teamId?: string | null
        },
    )
    expect(cloudflareCalls[0]).toMatchObject({
      signupMethod: "email",
      userId: undefined,
      teamId: undefined,
    })
    expect(cloudflareCalls[1]).toMatchObject({
      signupMethod: "email",
      userId: undefined,
      teamId: undefined,
    })
    expect(cloudflareCalls[0].signupAttemptId).not.toBe(
      cloudflareCalls[1].signupAttemptId,
    )
  })

  it("returns error when email is already registered", async () => {
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { message: "User already registered" },
    })

    const result = await signUpWithEmail(
      "existing@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({
      success: false,
      error: "An account with this email already exists.",
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("returns error message from supabase on other errors", async () => {
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { message: "Rate limit exceeded" },
    })

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({
      success: false,
      error: "Rate limit exceeded",
    })
  })

  it("returns error when token hash is missing", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: {} },
      error: null,
    })

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({
      success: false,
      error: "Failed to generate confirmation link.",
    })
  })

  it("returns generic error on unexpected exception", async () => {
    mockGenerateLink.mockRejectedValue(new Error("network error"))

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({
      success: false,
      error: "Error creating account. Please try again.",
    })
  })

  it("notifies slack after successful signup (fire and forget)", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "abc123" } },
      error: null,
    })
    mockSendEmail.mockResolvedValue({ success: true })
    mockSlack.mockResolvedValue({ success: true })

    await signUpWithEmail("user@test.com", "password123", "Test User")

    // Slack is called fire-and-forget via .catch(), give it a tick
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSlack).toHaveBeenCalled()
  })
})

describe("beginGoogleSignup", () => {
  beforeEach(() => {
    mockVerifyRecaptcha.mockReset().mockResolvedValue({ verified: true })
    mockIssueGoogleSignupProof.mockReset().mockResolvedValue(undefined)
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    mockObserveFingerprintSignup.mockReset().mockResolvedValue(undefined)
    mockFingerprintCookieDelete.mockReset()
    fingerprintSignupEventId = undefined
  })

  it("verifies signup_google before issuing a proof", async () => {
    const result = await beginGoogleSignup("google-token")

    expect(result).toEqual({
      success: true,
      signupAttemptId: expect.any(String),
    })
    expect(mockVerifyRecaptcha).toHaveBeenCalledWith(
      "google-token",
      "signup_google",
    )
    expect(mockIssueGoogleSignupProof).toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_captcha_verified",
      expect.any(String),
      { stage: "captcha_verification" },
    )
  })

  it("retains the fingerprint cookie for callback-side observation", async () => {
    fingerprintSignupEventId = encodeURIComponent("event-456")

    const result = await beginGoogleSignup("google-token")

    expect(result).toEqual({
      success: true,
      signupAttemptId: expect.any(String),
    })
    expect(mockFingerprintCookieDelete).not.toHaveBeenCalled()
    expect(fingerprintSignupEventId).toBe("event-456")
    expect(mockObserveFingerprintSignup).not.toHaveBeenCalled()
  })

  it("fails closed when proof issuance is unavailable", async () => {
    mockIssueGoogleSignupProof.mockRejectedValue(
      new Error("Google signup proof signing secret is not configured"),
    )

    await expect(beginGoogleSignup("google-token")).resolves.toEqual({
      success: false,
      error: "Google signup is temporarily unavailable. Please try again.",
      errorCode: "proof_unavailable",
    })
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_captcha_failed",
      expect.any(String),
      {
        reason: "Google signup proof signing secret is not configured",
        stage: "proof_issuance",
      },
    )
  })

  it("returns a captcha error when reCAPTCHA verification fails", async () => {
    mockVerifyRecaptcha.mockResolvedValue({
      verified: false,
      reason: "low_score",
    })

    await expect(beginGoogleSignup("google-token")).resolves.toEqual({
      success: false,
      error: "We couldn't verify you're human. Please try again.",
      errorCode: "captcha_failed",
    })
    expect(mockIssueGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_captcha_failed",
      expect.any(String),
      {
        reason: "low_score",
        stage: "captcha_verification",
      },
    )
  })
})
