import { beforeEach, describe, expect, it, vi } from "vitest"

let currentUser: {
  id: string
  email: string
  created_at: string
  app_metadata: { provider: string; providers?: string[] }
  user_metadata: { full_name?: string }
} | null = null

let proofAvailable = true
let directoryState = {
  memberships: [] as Array<{ teamId: string; region: string }>,
  degradedRegions: [] as string[],
}
let googleMembershipState:
  | { kind: "existing"; membership: { teamId: string; region: string } }
  | { kind: "first_time" }
  | { kind: "indeterminate"; degradedRegions: string[] } = {
  kind: "existing",
  membership: { teamId: "team-1", region: "use" },
}

const mockNotifySlackOfNewUser = vi.fn()
vi.mock("@/app/(auth)/auth/signin/action", () => ({
  notifySlackOfNewUser: (...args: unknown[]) =>
    mockNotifySlackOfNewUser(...args),
}))

const mockSendWelcomeEmail = vi.fn()
const mockConsumeFingerprintSignupEventId = vi.fn()
const mockScheduleFingerprintObservation = vi.fn()
vi.mock("@/app/(auth)/auth/signup/action", () => ({
  sendWelcomeEmail: (...args: unknown[]) => mockSendWelcomeEmail(...args),
  consumeFingerprintSignupEventId: (...args: unknown[]) =>
    mockConsumeFingerprintSignupEventId(...args),
  scheduleFingerprintObservation: (...args: unknown[]) =>
    mockScheduleFingerprintObservation(...args),
}))

const mockHasValidGoogleSignupProof = vi.fn()
const mockHasValidLegacyGoogleSignupProof = vi.fn()
const mockConsumeGoogleSignupProof = vi.fn()
const mockMarkGoogleSignupAttempt = vi.fn()
const mockEnsureGoogleOnboardingMembership = vi.fn()
const mockListTeamMembershipsForUserDetailed = vi.fn(
  async (_userId: string, _opts?: { maxAgeMs?: number }) => directoryState,
)
const mockClassifyGoogleMembershipState = vi.fn(
  async (
    _userId: string,
    _directory: {
      memberships: Array<{ teamId: string; region: string }>
      degradedRegions: string[]
    },
  ) => googleMembershipState,
)
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: (
    ...args: [string, { maxAgeMs?: number }?]
  ) => mockListTeamMembershipsForUserDetailed(...args),
}))
vi.mock("@/lib/auth/google-signup-proof", () => ({
  hasValidGoogleSignupProof: (...args: unknown[]) =>
    mockHasValidGoogleSignupProof(...args),
  hasValidLegacyGoogleSignupProof: (...args: unknown[]) =>
    mockHasValidLegacyGoogleSignupProof(...args),
  consumeGoogleSignupProof: (...args: unknown[]) =>
    mockConsumeGoogleSignupProof(...args),
  markGoogleSignupAttempt: (...args: unknown[]) =>
    mockMarkGoogleSignupAttempt(...args),
  isGoogleUser: (user: {
    app_metadata?: { provider?: string; providers?: string[] }
  }) =>
    user.app_metadata?.provider === "google" ||
    user.app_metadata?.providers?.includes("google") === true,
}))
vi.mock("@/lib/auth/google-onboarding", () => ({
  classifyGoogleMembershipState: (
    userId: string,
    directory: {
      memberships: Array<{ teamId: string; region: string }>
      degradedRegions: string[]
    },
  ) => mockClassifyGoogleMembershipState(userId, directory),
  ensureGoogleOnboardingMembership: (...args: unknown[]) =>
    mockEnsureGoogleOnboardingMembership(...args),
}))

const mockTrackEvent = vi.fn()
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    GOOGLE_SIGNUP_BYPASS_BLOCKED: "auth_google_signup_bypass_blocked",
    SIGNUP_ATTEMPT_ASSOCIATED: "auth_signup_attempt_associated",
    SIGN_IN_FAILED: "sign_in_failed",
    SIGN_UP_COMPLETED: "sign_up_completed",
    SIGN_IN_COMPLETED: "sign_in_completed",
  },
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      verifyOtp: async () => ({ error: null }),
      getUser: async () => ({ data: { user: currentUser } }),
    },
  }),
}))

import { GET } from "./route"

describe("auth callback", () => {
  beforeEach(() => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      created_at: new Date().toISOString(),
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: { full_name: "Test User" },
    }
    directoryState = { memberships: [], degradedRegions: [] }
    googleMembershipState = {
      kind: "existing",
      membership: { teamId: "team-1", region: "use" },
    }
    mockNotifySlackOfNewUser.mockReset()
    mockNotifySlackOfNewUser.mockResolvedValue(undefined)
    mockSendWelcomeEmail.mockReset()
    mockSendWelcomeEmail.mockResolvedValue(undefined)
    mockConsumeFingerprintSignupEventId.mockReset()
    mockConsumeFingerprintSignupEventId.mockResolvedValue(undefined)
    mockScheduleFingerprintObservation.mockReset()
    mockListTeamMembershipsForUserDetailed
      .mockReset()
      .mockImplementation(async () => directoryState)
    proofAvailable = true
    mockHasValidGoogleSignupProof
      .mockReset()
      .mockImplementation(async () => proofAvailable)
    mockHasValidLegacyGoogleSignupProof
      .mockReset()
      .mockImplementation(async () => proofAvailable)
    mockConsumeGoogleSignupProof.mockReset()
    mockEnsureGoogleOnboardingMembership
      .mockReset()
      .mockResolvedValue(undefined)
    mockClassifyGoogleMembershipState
      .mockReset()
      .mockImplementation(async () => googleMembershipState)
    mockTrackEvent.mockReset()
  })

  it("lets an established Google user through without requiring proof", async () => {
    googleMembershipState = {
      kind: "existing",
      membership: { teamId: "team-1", region: "use" },
    }

    const response = await GET(
      new Request("https://console.superserve.ai/auth/callback?code=abc"),
    )

    expect(mockHasValidGoogleSignupProof).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockTrackEvent).toHaveBeenCalled()
    expect(mockSendWelcomeEmail).not.toHaveBeenCalled()
    expect(proofAvailable).toBe(true)
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("accepts an in-flight legacy Google callback without an attempt ID", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidLegacyGoogleSignupProof.mockResolvedValue(true)

    const response = await GET(
      new Request("https://console.superserve.ai/auth/callback?code=abc"),
    )

    expect(mockHasValidLegacyGoogleSignupProof).toHaveBeenCalledWith()
    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("fails transiently when the membership directory is degraded and no marker is available", async () => {
    googleMembershipState = {
      kind: "indeterminate",
      degradedRegions: ["usw"],
    }

    const response = await GET(
      new Request("https://console.superserve.ai/auth/callback?code=abc"),
    )

    expect(mockHasValidGoogleSignupProof).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toContain(
      "/auth/auth-code-error?reason=membership_lookup_degraded",
    )
    expect(mockTrackEvent).toHaveBeenCalledWith("sign_in_failed", "u1", {
      provider: "google",
      email: "user@example.com",
      reason: "membership_lookup_degraded",
    })
  })

  it("lets a first-time Google user through when proof is valid", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(mockHasValidGoogleSignupProof).toHaveBeenCalledWith("attempt-1")
    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
      "google",
    )
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
    )
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith("sign_up_completed", "u1", {
      provider: "google",
      email: "user@example.com",
      is_new_user: true,
    })
  })

  it("associates a first-time Google signup observation with the callback user", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)
    mockConsumeFingerprintSignupEventId.mockResolvedValue("event-1")

    await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(mockConsumeFingerprintSignupEventId).toHaveBeenCalled()
    expect(mockScheduleFingerprintObservation).toHaveBeenCalledWith(
      "event-1",
      "google",
      "u1",
      "attempt-1",
    )
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_signup_attempt_associated",
      "u1",
      {
        signup_attempt_id: "attempt-1",
        superserve_user_id: "u1",
        signup_method: "google",
        observed_at: expect.any(String),
      },
    )
  })
})
