import crypto from "node:crypto"

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

type CookieSet = {
  name: string
  value: string
  options: Record<string, unknown>
}

let cookieValue: string | undefined
const cookieSets: CookieSet[] = []

const mockTrackEvent = vi.fn()
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    GOOGLE_SIGNUP_BYPASS_BLOCKED: "auth_google_signup_bypass_blocked",
    GOOGLE_SIGNUP_PROOF_CONSUMED: "auth_google_signup_proof_consumed",
  },
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValue === undefined ? undefined : { name, value: cookieValue },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieValue = value
      cookieSets.push({ name, value, options })
    },
    delete: () => {
      cookieValue = undefined
    },
  }),
}))

function signProofPayload(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = crypto
    .createHmac("sha256", process.env.GOOGLE_SIGNUP_PROOF_SECRET ?? "")
    .update(encoded)
    .digest("base64url")
  return `${encoded}.${signature}`
}

import {
  hasValidGoogleSignupProof,
  consumeGoogleSignupProof,
  issueGoogleSignupProof,
  requireGoogleSignupProof,
} from "./google-signup-proof"

describe("google-signup-proof", () => {
  beforeEach(() => {
    cookieValue = undefined
    cookieSets.length = 0
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    process.env.GOOGLE_SIGNUP_PROOF_SECRET = "g".repeat(32)
  })

  afterEach(() => {
    delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
  })

  it("issues a signed HttpOnly proof cookie that validates", async () => {
    await issueGoogleSignupProof()

    expect(cookieSets).toHaveLength(1)
    expect(cookieSets[0]).toMatchObject({
      name: "__Host-superserve-google-signup",
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 300,
      },
    })
    expect(cookieSets[0].value).toContain(".")
    expect(await hasValidGoogleSignupProof()).toBe(true)
  })

  it("tracks proof consumption when the cookie is cleared", async () => {
    await issueGoogleSignupProof()
    mockTrackEvent.mockReset().mockResolvedValue(undefined)

    await consumeGoogleSignupProof("user-123")

    expect(cookieValue).toBeUndefined()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_proof_consumed",
      "user-123",
      { scope: "first_team_provisioning" },
    )
  })

  it("keeps a validated proof available until provisioning consumes it", async () => {
    await issueGoogleSignupProof()

    expect(await hasValidGoogleSignupProof()).toBe(true)
    expect(cookieValue).toBeDefined()

    await consumeGoogleSignupProof("user-123")

    expect(cookieValue).toBeUndefined()
  })

  it("treats an expired proof as invalid", async () => {
    await issueGoogleSignupProof()
    expect(await hasValidGoogleSignupProof()).toBe(true)

    const issuedAt = Date.now()
    vi.useFakeTimers()
    vi.setSystemTime(issuedAt + 301_000)
    try {
      expect(await hasValidGoogleSignupProof()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects a tampered proof cookie", async () => {
    await issueGoogleSignupProof()
    expect(cookieValue).toBeDefined()

    const [payload, signature] = cookieValue!.split(".")
    const replacement = signature[0] === "A" ? "B" : "A"
    cookieValue = `${payload}.${replacement}${signature.slice(1)}`

    expect(await hasValidGoogleSignupProof()).toBe(false)
  })

  it("rejects a validly signed proof with the wrong purpose", async () => {
    cookieValue = signProofPayload({
      v: 1,
      purpose: "signup_email",
      exp: Math.floor(Date.now() / 1000) + 300,
    })

    expect(await hasValidGoogleSignupProof()).toBe(false)
  })

  it("fails closed when the signing secret is missing", async () => {
    delete process.env.GOOGLE_SIGNUP_PROOF_SECRET

    await expect(issueGoogleSignupProof()).rejects.toThrow(
      "Google signup proof signing secret is not configured",
    )
    expect(await hasValidGoogleSignupProof()).toBe(false)
  })

  it("fails closed when the signing secret is too short", async () => {
    process.env.GOOGLE_SIGNUP_PROOF_SECRET = "short"

    await expect(issueGoogleSignupProof()).rejects.toThrow(
      "Google signup proof signing secret is not configured",
    )
    expect(await hasValidGoogleSignupProof()).toBe(false)
  })

  it("tracks a bypass block with a distinct telemetry id", async () => {
    await expect(requireGoogleSignupProof()).rejects.toThrow(
      "Google signup verification required",
    )
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_bypass_blocked",
      expect.any(String),
      { reason: "missing_or_invalid_proof", scope: "first_team_provisioning" },
    )
  })
})
