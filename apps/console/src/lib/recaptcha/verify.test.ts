/**
 * verifyRecaptcha — the server-side gate on signup.
 *
 * Tests exercise the configured path (all three env vars set), which the
 * signup action/page tests don't cover since they run without reCAPTCHA
 * configured and only prove the unconfigured fail-open behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { verifyRecaptcha } from "./verify"

const ORIGINAL_ENV = {
  RECAPTCHA_API_KEY: process.env.RECAPTCHA_API_KEY,
  RECAPTCHA_PROJECT_ID: process.env.RECAPTCHA_PROJECT_ID,
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
  RECAPTCHA_SCORE_THRESHOLD: process.env.RECAPTCHA_SCORE_THRESHOLD,
}

function restoreEnv() {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

function configure() {
  process.env.RECAPTCHA_API_KEY = "test-api-key"
  process.env.RECAPTCHA_PROJECT_ID = "test-project"
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = "test-site-key"
}

function okResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe("verifyRecaptcha (unconfigured)", () => {
  beforeEach(() => {
    delete process.env.RECAPTCHA_API_KEY
    delete process.env.RECAPTCHA_PROJECT_ID
    delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
  })

  afterEach(() => {
    restoreEnv()
    fetchSpy.mockReset()
  })

  it("fails open without calling the assessment API", async () => {
    const result = await verifyRecaptcha("some-token", "signup")
    expect(result).toEqual({ verified: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fails closed when reCAPTCHA is only partially configured", async () => {
    process.env.RECAPTCHA_API_KEY = "test-api-key"
    const result = await verifyRecaptcha(undefined, "signup")
    expect(result).toEqual({ verified: false, reason: "configuration_error" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("verifyRecaptcha (configured)", () => {
  beforeEach(() => {
    configure()
    fetchSpy.mockReset()
  })

  afterEach(() => {
    restoreEnv()
    fetchSpy.mockReset()
  })

  it("rejects a missing token without calling the assessment API", async () => {
    const result = await verifyRecaptcha(undefined, "signup")
    expect(result).toEqual({ verified: false, reason: "missing_token" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects a non-string token without calling the assessment API", async () => {
    const result = await verifyRecaptcha({ token: "x" }, "signup")
    expect(result).toEqual({ verified: false, reason: "missing_token" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects an oversized token without calling the assessment API", async () => {
    const result = await verifyRecaptcha("a".repeat(5000), "signup")
    expect(result).toEqual({ verified: false, reason: "token_too_long" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects a token the assessment API marks invalid", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: false, invalidReason: "EXPIRED" },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: false, reason: "EXPIRED" })
  })

  it("rejects when the assessment action doesn't match", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signin" },
        riskAnalysis: { score: 0.9 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: false, reason: "action_mismatch" })
  })

  it("rejects a score below the default threshold", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.2 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: false, reason: "low_score:0.2" })
  })

  it("rejects a missing score the same as the lowest score", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({ tokenProperties: { valid: true, action: "signup" } }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: false, reason: "missing_score" })
  })

  it("verifies a valid token with a passing score", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.9 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: true })
  })

  it("respects a configured RECAPTCHA_SCORE_THRESHOLD", async () => {
    process.env.RECAPTCHA_SCORE_THRESHOLD = "0.9"
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.8 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: false, reason: "low_score:0.8" })
  })

  it("falls back to the default threshold for an out-of-range override", async () => {
    process.env.RECAPTCHA_SCORE_THRESHOLD = "5"
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.6 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: true })
  })

  it("fails closed on quota exhaustion (429) rather than opening the gate", async () => {
    fetchSpy.mockResolvedValue(new Response("rate limited", { status: 429 }))
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: false, reason: "quota_exhausted" })
  })

  it("fails closed on credential/configuration HTTP errors", async () => {
    fetchSpy.mockResolvedValue(new Response("forbidden", { status: 403 }))
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({
      verified: false,
      reason: "assessment_http_403",
    })
  })

  it("fails open on transient provider errors", async () => {
    fetchSpy.mockResolvedValue(new Response("unavailable", { status: 503 }))
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: true })
  })

  it("fails open when the request itself errors (network failure/timeout)", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"))
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: true })
  })

  it("sends the token, site key, and expected action to the assessment API", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.9 },
      }),
    )
    await verifyRecaptcha("my-token", "signup")

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://recaptchaenterprise.googleapis.com/v1/projects/test-project/assessments",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          event: {
            token: "my-token",
            siteKey: "test-site-key",
            expectedAction: "signup",
          },
        }),
        signal: expect.any(AbortSignal),
      }),
    )
  })
})
