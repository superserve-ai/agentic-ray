import { beforeEach, describe, expect, it, vi } from "vitest"

const teamRows = [
  {
    id: "11111111-1111-1111-1111-111111111111",
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
vi.mock("@/lib/admin/permissions", () => ({
  canReadPlatformTeams: vi.fn(),
  canStartPlatformImpersonation: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  clearImpersonationCookie: vi.fn(),
  readImpersonationContext: vi.fn(),
  setImpersonationCookie: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation-key", () => ({
  revokeImpersonationKeyRow: vi.fn(),
}))
vi.mock("@/lib/api/team-directory", () => ({
  findTeamById: vi.fn(),
  listAllTeams: vi.fn(),
}))

import {
  clearImpersonationCookie,
  readImpersonationContext,
  setImpersonationCookie,
} from "@/lib/admin/impersonation"
import { revokeImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import {
  canReadPlatformTeams,
  canStartPlatformImpersonation,
} from "@/lib/admin/permissions"
import { findTeamById, listAllTeams } from "@/lib/api/team-directory"
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
    vi.mocked(readImpersonationContext).mockResolvedValue({
      teamId: teamRows[0].id,
      region: "use",
    })
    vi.mocked(setImpersonationCookie).mockResolvedValue(undefined)
    vi.mocked(clearImpersonationCookie).mockResolvedValue(undefined)
    vi.mocked(revokeImpersonationKeyRow).mockResolvedValue(undefined)
    vi.mocked(listAllTeams).mockResolvedValue([
      { ...teamRows[0], region: "use" },
    ])
    vi.mocked(findTeamById).mockResolvedValue({
      ...teamRows[0],
      region: "use",
    })
  })

  it("lists teams only when the explicit team read permission is present", async () => {
    const rows = await listAllTeamsAction()
    expect(rows).toEqual(teamRows)
    expect(canReadPlatformTeams).toHaveBeenCalled()
  })

  it("rejects start impersonation when the user lacks supported read scopes", async () => {
    vi.mocked(canStartPlatformImpersonation).mockReturnValue(false)

    await expect(startImpersonationAction(teamRows[0].id)).rejects.toThrow(
      /platform impersonation access required/,
    )
    expect(setImpersonationCookie).not.toHaveBeenCalled()
  })

  it("validates the target team before setting the impersonation cookie", async () => {
    vi.mocked(findTeamById).mockResolvedValueOnce(null)

    await expect(startImpersonationAction(teamRows[0].id)).rejects.toThrow(
      "Team not found",
    )
    expect(setImpersonationCookie).not.toHaveBeenCalled()
  })

  it("revokes the impersonation key when stopping impersonation", async () => {
    const clearImpersonationCookieMock = vi.mocked(clearImpersonationCookie)
    const revokeImpersonationKeyRowMock = vi.mocked(revokeImpersonationKeyRow)

    await expect(stopImpersonationAction()).rejects.toThrow("redirect")
    expect(clearImpersonationCookieMock).toHaveBeenCalled()
    expect(revokeImpersonationKeyRowMock).toHaveBeenCalledWith(
      "admin-1",
      teamRows[0].id,
      "use",
    )
    expect(
      clearImpersonationCookieMock.mock.invocationCallOrder[0],
    ).toBeLessThan(revokeImpersonationKeyRowMock.mock.invocationCallOrder[0])
  })

  it("allows the team detail lookup to run behind the team-read gate", async () => {
    const team = await getTeamAction(teamRows[0].id)
    expect(team).toEqual(teamRows[0])
  })
})
