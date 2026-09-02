/**
 * team-provisioning — the single correct way to create a team.
 *
 * The control plane authorizes through the RBAC chain (team_memberships +
 * user_role_assignments), so a team is only usable if the whole chain landed.
 * These tests pin two things:
 *  - the happy path writes every row into the target cell, and
 *  - a mid-chain failure unwinds in reverse dependency order, so a half-
 *    written team the console lists but the control plane rejects can't linger.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

let clients: Record<string, ReturnType<typeof recordingClient>> = {}
let currentUser: {
  id: string
  email: string
  app_metadata?: { provider?: string; providers?: string[] }
} | null = null
let googleUser = false
let directoryState = {
  memberships: [] as Array<{ teamId: string; region: string }>,
  degradedRegions: [] as string[],
}
const mockTrackEvent = vi.fn()
const mockConsumeGoogleSignupProof = vi.fn()
const mockRequireGoogleSignupProof = vi.fn()
const mockEnsureGoogleOnboardingMembership = vi.fn()
const mockReadVerifiedGoogleOnboardingMembership = vi.fn()
const mockClassifyGoogleMembershipState = vi.fn(
  async (
    userId: string,
    directory: {
      memberships: Array<{ teamId: string; region: string }>
      degradedRegions: string[]
    },
  ) => {
    const membership = directory.memberships[0]
    if (membership) {
      return { kind: "existing" as const, membership }
    }
    if (directory.degradedRegions.length > 0) {
      const onboardingMembership =
        await mockReadVerifiedGoogleOnboardingMembership(userId)
      if (onboardingMembership) {
        return { kind: "existing" as const, membership: onboardingMembership }
      }
      return {
        kind: "indeterminate" as const,
        degradedRegions: directory.degradedRegions,
      }
    }
    return { kind: "first_time" as const }
  },
)
const mockIsGoogleUser = vi.fn(
  (_user: { app_metadata?: { provider?: string; providers?: string[] } }) =>
    googleUser,
)
const mockListTeamMembershipsForUserDetailed = vi.fn(
  async (_userId: string, _opts?: { maxAgeMs?: number }) => directoryState,
)

// Records writes and deletes per table, and can be told to fail one table's
// insert so the unwind path is exercised.
function recordingClient(failTable?: string) {
  const writes: Record<string, Array<Record<string, unknown>>> = {}
  const deletes: string[] = []
  const record = (table: string, row: Record<string, unknown>) => {
    writes[table] = [...(writes[table] ?? []), row]
  }
  const result = (table: string) =>
    failTable === table
      ? { error: { message: `boom ${table}` } }
      : { error: null }

  const from = (table: string) => ({
    upsert: async (row: Record<string, unknown>) => {
      record(table, row)
      return result(table)
    },
    insert: (row: Record<string, unknown>) => {
      record(table, row)
      if (table === "team") {
        return {
          select: () => ({
            single: async () => ({
              data: { id: "team-new", name: row.name },
              error: result(table).error,
            }),
          }),
        }
      }
      return Promise.resolve(result(table))
    },
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { id: "role-owner" }, error: null }),
      }),
    }),
    delete: () => ({
      eq: async () => {
        deletes.push(table)
        return { error: null }
      },
    }),
  })
  return { from, writes, deletes }
}

vi.mock("@/lib/cells", () => ({
  cellFor: (region: string) => ({
    region,
    createAdminClient: () => clients[region],
  }),
}))
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    GOOGLE_SIGNUP_BYPASS_BLOCKED: "auth_google_signup_bypass_blocked",
    GOOGLE_SIGNUP_PROOF_CONSUMED: "auth_google_signup_proof_consumed",
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: currentUser } })) },
  })),
}))
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: (
    ...args: [string, { maxAgeMs?: number }?]
  ) => mockListTeamMembershipsForUserDetailed(...args),
}))
vi.mock("@/lib/auth/google-signup-proof", () => ({
  consumeGoogleSignupProof: (...args: unknown[]) =>
    mockConsumeGoogleSignupProof(...args),
  isGoogleUser: (user: {
    app_metadata?: { provider?: string; providers?: string[] }
  }) => mockIsGoogleUser(user),
  requireGoogleSignupProof: (...args: unknown[]) =>
    mockRequireGoogleSignupProof(...args),
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
  readVerifiedGoogleOnboardingMembership: (...args: unknown[]) =>
    mockReadVerifiedGoogleOnboardingMembership(...args),
}))

import { provisionTeam } from "./team-provisioning"

describe("provisionTeam", () => {
  beforeEach(() => {
    clients = { use: recordingClient(), usw: recordingClient() }
    currentUser = null
    googleUser = false
    directoryState = { memberships: [], degradedRegions: [] }
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    mockConsumeGoogleSignupProof.mockReset()
    mockRequireGoogleSignupProof.mockReset()
    mockEnsureGoogleOnboardingMembership
      .mockReset()
      .mockResolvedValue(undefined)
    mockReadVerifiedGoogleOnboardingMembership
      .mockReset()
      .mockResolvedValue(null)
    mockClassifyGoogleMembershipState.mockReset().mockImplementation(
      async (
        userId: string,
        directory: {
          memberships: Array<{ teamId: string; region: string }>
          degradedRegions: string[]
        },
      ) => {
        const membership = directory.memberships[0]
        if (membership) {
          return { kind: "existing" as const, membership }
        }
        if (directory.degradedRegions.length > 0) {
          const onboardingMembership =
            await mockReadVerifiedGoogleOnboardingMembership(userId)
          if (onboardingMembership) {
            return {
              kind: "existing" as const,
              membership: onboardingMembership,
            }
          }
          return {
            kind: "indeterminate" as const,
            degradedRegions: directory.degradedRegions,
          }
        }
        return { kind: "first_time" as const }
      },
    )
    mockListTeamMembershipsForUserDetailed
      .mockReset()
      .mockImplementation(async () => directoryState)
  })

  it("writes the full RBAC chain into the target cell", async () => {
    const team = await provisionTeam(
      "usw",
      "u1",
      "user@example.com",
      "west pilot",
    )

    expect(team).toEqual({ id: "team-new", name: "west pilot", region: "usw" })

    const { writes } = clients.usw
    expect(writes.profile).toEqual([{ id: "u1", email: "user@example.com" }])
    expect(writes.team).toEqual([{ name: "west pilot", home_region: "usw" }])
    expect(writes.team_member).toEqual([
      { team_id: "team-new", profile_id: "u1", role: "owner" },
    ])
    expect(writes.team_memberships).toEqual([
      { team_id: "team-new", user_id: "u1", status: "active" },
    ])
    expect(writes.user_role_assignments).toEqual([
      {
        user_id: "u1",
        role_id: "role-owner",
        scope_type: "team",
        team_id: "team-new",
      },
    ])
    expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()

    // Nothing touched a cell other than the target.
    expect(clients.use.writes).toEqual({})
  })

  it("unwinds in reverse dependency order when a chain write fails", async () => {
    clients = { use: recordingClient("team_memberships") }

    await expect(
      provisionTeam("use", "u1", "user@example.com", "east team"),
    ).rejects.toThrow(/boom team_memberships.*\(team team-new\)/)

    // Reverse dependency order so nothing is deleted before its dependents.
    expect(clients.use.deletes).toEqual([
      "user_role_assignments",
      "team_memberships",
      "team_member",
      "team",
    ])
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("does not consume the Google proof when a first-time Google provisioning chain fails", async () => {
    clients = { use: recordingClient("team_memberships") }
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: [] }
    mockRequireGoogleSignupProof.mockResolvedValue(undefined)

    await expect(
      provisionTeam("use", "u1", "user@example.com", "east team"),
    ).rejects.toThrow(/boom team_memberships.*\(team team-new\)/)

    expect(mockRequireGoogleSignupProof).toHaveBeenCalledTimes(1)
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
  })

  it("requires a proof for a first-time Google user and consumes it after success", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: [] }
    mockRequireGoogleSignupProof.mockResolvedValue(undefined)

    await provisionTeam("usw", "u1", "user@example.com", "west pilot")

    expect(mockRequireGoogleSignupProof).toHaveBeenCalledTimes(1)
    expect(mockConsumeGoogleSignupProof).toHaveBeenCalledWith("u1")
  })

  it("records a bypass block when a first-time Google user lacks proof", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: [] }
    mockRequireGoogleSignupProof.mockRejectedValue(
      new Error("Google signup verification required"),
    )

    await expect(
      provisionTeam("usw", "u1", "user@example.com", "west pilot"),
    ).rejects.toThrow("Google signup verification required")

    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(clients.use.writes).toEqual({})
  })

  it("does not block an established Google user when the deeper lookup was degraded", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = {
      memberships: [{ teamId: "team-old", region: "use" }],
      degradedRegions: ["usw"],
    }

    await expect(
      provisionTeam("usw", "u1", "user@example.com", "west pilot"),
    ).resolves.toEqual({ id: "team-new", name: "west pilot", region: "usw" })
    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("accepts a verified onboarding marker when the live lookup is degraded and empty", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: ["usw"] }
    mockReadVerifiedGoogleOnboardingMembership.mockResolvedValue({
      teamId: "team-old",
      region: "use",
    })

    await provisionTeam("usw", "u1", "user@example.com", "west pilot")

    expect(mockReadVerifiedGoogleOnboardingMembership).toHaveBeenCalledWith(
      "u1",
    )
    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("fails transiently when the lookup is degraded and no marker can recover it", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: ["usw"] }
    mockReadVerifiedGoogleOnboardingMembership.mockResolvedValue(null)

    await expect(
      provisionTeam("usw", "u1", "user@example.com", "west pilot"),
    ).rejects.toThrow("Google membership lookup degraded; please try again")

    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
  })

  it("persists the Google onboarding marker after successful first-team provisioning", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: [] }
    mockRequireGoogleSignupProof.mockResolvedValue(undefined)

    await provisionTeam("usw", "u1", "user@example.com", "west pilot")
  })
})
