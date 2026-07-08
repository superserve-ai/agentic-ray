import { beforeEach, describe, expect, it, vi } from "vitest"

const teamRows = [
  {
    id: "team-1",
    name: "Team One",
    active_sandbox_count: 1,
    max_sandboxes: 5,
    created_at: "2024-01-01T00:00:00.000Z",
  },
]

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect")
  }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}))
vi.mock("@/lib/admin/permissions", () => ({
  canReadPlatformTeams: vi.fn(),
  canStartPlatformImpersonation: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  clearImpersonationCookie: vi.fn(),
  readImpersonationTeamId: vi.fn(),
  setImpersonationCookie: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation-key", () => ({
  revokeImpersonationKeyRow: vi.fn(),
}))

import {
  canReadPlatformTeams,
  canStartPlatformImpersonation,
} from "@/lib/admin/permissions"
import {
  clearImpersonationCookie,
  readImpersonationTeamId,
  setImpersonationCookie,
} from "@/lib/admin/impersonation"
import { revokeImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

import {
  getTeamAction,
  listAllTeamsAction,
  startImpersonationAction,
  stopImpersonationAction,
} from "./teams-actions"

describe("teams actions", () => {
  beforeEach(() => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    } as never)
    vi.mocked(canReadPlatformTeams).mockReturnValue(true)
    vi.mocked(canStartPlatformImpersonation).mockReturnValue(true)
    vi.mocked(readImpersonationTeamId).mockResolvedValue("team-1")
    vi.mocked(setImpersonationCookie).mockResolvedValue(undefined)
    vi.mocked(clearImpersonationCookie).mockResolvedValue(undefined)
    vi.mocked(revokeImpersonationKeyRow).mockResolvedValue(undefined)
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => ({
        select: () => ({
          order: () => ({
            limit: async () => ({ data: teamRows, error: null }),
          }),
          eq: () => ({
            single: async () => ({
              data: teamRows[0],
              error: null,
            }),
          }),
        }),
      }),
    } as never)
  })

  it("lists teams only when the explicit team read permission is present", async () => {
    const rows = await listAllTeamsAction()
    expect(rows).toEqual(teamRows)
    expect(canReadPlatformTeams).toHaveBeenCalled()
  })

  it("rejects start impersonation when the user lacks supported read scopes", async () => {
    vi.mocked(canStartPlatformImpersonation).mockReturnValue(false)

    await expect(startImpersonationAction("team-1")).rejects.toThrow(
      /platform impersonation access required/,
    )
    expect(setImpersonationCookie).not.toHaveBeenCalled()
  })

  it("validates the target team before setting the impersonation cookie", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as never)

    await expect(startImpersonationAction("team-1")).rejects.toThrow(
      "Team not found",
    )
    expect(setImpersonationCookie).not.toHaveBeenCalled()
  })

  it("revokes the impersonation key when stopping impersonation", async () => {
    await expect(stopImpersonationAction()).rejects.toThrow("redirect")
    expect(clearImpersonationCookie).toHaveBeenCalled()
    expect(revokeImpersonationKeyRow).toHaveBeenCalledWith("admin-1", "team-1")
  })

  it("allows the team detail lookup to run behind the team-read gate", async () => {
    const team = await getTeamAction("team-1")
    expect(team).toEqual(teamRows[0])
  })
})
