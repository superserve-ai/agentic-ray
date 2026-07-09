import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "u1", email: "pavitra@superserve.ai" } },
      }),
    },
  }),
}))

// Per-test knobs read lazily by the cells mock.
let regions: string[] = ["use", "usw"]
let allowedRegions: string[] | null = null
let switchingAllowed = true
let cellClients: Record<string, ReturnType<typeof recordingCellClient>> = {}

// Records every write per table so tests can assert the full create chain
// landed in one cell and nowhere else.
function recordingCellClient() {
  const writes: Record<string, Array<Record<string, unknown>>> = {}
  const record = (table: string, row: Record<string, unknown>) => {
    writes[table] = [...(writes[table] ?? []), row]
  }
  const from = vi.fn((table: string) => {
    switch (table) {
      case "profile":
        return {
          upsert: async (row: Record<string, unknown>) => {
            record(table, row)
            return { error: null }
          },
        }
      case "team":
        return {
          insert: (row: Record<string, unknown>) => {
            record(table, row)
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "team-new", name: row.name },
                  error: null,
                }),
              }),
            }
          },
        }
      case "team_member":
      case "team_memberships":
      case "user_role_assignments":
        return {
          insert: async (row: Record<string, unknown>) => {
            record(table, row)
            return { error: null }
          },
          // The directory's RBAC-authoritative lookup also selects from
          // team_memberships; empty = legacy-discovery path.
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        }
      case "roles":
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: "role-owner" },
                error: null,
              }),
            }),
          }),
        }
      default:
        throw new Error(`unexpected table ${table}`)
    }
  })
  return { from, writes }
}

vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  configuredRegions: () => regions,
  creatableRegions: () => allowedRegions ?? regions,
  multiCellUiEnabled: () => switchingAllowed,
  cellFor: (region: string) => {
    if (!regions.includes(region)) {
      throw new Error(`Region ${region} is not configured`)
    }
    return {
      region,
      apiBaseUrl: `https://api-${region}.test`,
      createAdminClient: () => cellClients[region],
    }
  },
}))

let directoryTeams: Array<{ id: string; name: string; region: string }> = []
vi.mock("@/lib/api/team-directory", () => ({
  listTeamsForUser: async () => directoryTeams,
  membershipExistsInCell: async (
    region: string,
    _userId: string,
    teamId: string,
  ) => directoryTeams.some((t) => t.id === teamId && t.region === region),
  invalidateMembershipDirectory: () => {},
}))

// Cookie store stub capturing active-team writes.
let cookieValue: string | undefined
const cookieSets: Array<{ name: string; value: string }> = []
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValue !== undefined ? { name, value: cookieValue } : undefined,
    set: (name: string, value: string) => {
      cookieSets.push({ name, value })
      cookieValue = value
    },
  }),
}))

import {
  createTeamAction,
  listTeamsAction,
  setActiveTeamAction,
} from "./teams-actions"

describe("createTeamAction", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
    allowedRegions = null
    directoryTeams = []
    cookieValue = undefined
    cookieSets.length = 0
    cellClients = {
      use: recordingCellClient(),
      usw: recordingCellClient(),
    }
  })

  it("writes the full RBAC chain into the target cell", async () => {
    const team = await createTeamAction("west pilot", "usw")

    expect(team).toEqual({ id: "team-new", name: "west pilot", region: "usw" })

    const writes = cellClients.usw.writes
    expect(writes.profile).toEqual([
      { id: "u1", email: "pavitra@superserve.ai" },
    ])
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

    // Nothing leaked into the default cell.
    expect(cellClients.use.from).not.toHaveBeenCalled()

    // The creator lands in the new team.
    expect(cookieSets).toEqual([
      { name: "ss-active-team", value: "usw:team-new" },
    ])
  })

  it("defaults to the default region when none is given", async () => {
    const team = await createTeamAction("east team")

    expect(team.region).toBe("use")
    expect(cellClients.use.writes.team).toEqual([
      { name: "east team", home_region: "use" },
    ])
    expect(cellClients.usw.from).not.toHaveBeenCalled()
  })

  it("rejects a region that is not configured", async () => {
    regions = ["use"]
    await expect(createTeamAction("west pilot", "usw")).rejects.toThrow(
      "Region usw is not available",
    )
  })

  it("rejects an empty team name", async () => {
    await expect(createTeamAction("   ")).rejects.toThrow(
      "Team name is required",
    )
  })
})

describe("multi-cell allowlist enforcement", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
  })

  it("rejects creating in a configured region the user is not allowed into", async () => {
    allowedRegions = ["use"]
    await expect(createTeamAction("Pilot", "usw")).rejects.toThrow(
      "Region usw is not available",
    )
  })

  it("returns only the user's creatable regions from the directory action", async () => {
    allowedRegions = ["use"]
    const { regions: visible } = await listTeamsAction()
    expect(visible).toEqual(["use"])
  })
})

describe("active team", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
    allowedRegions = null
    switchingAllowed = true
    cookieValue = undefined
    cookieSets.length = 0
    directoryTeams = [
      { id: "team-a", name: "alpha", region: "use" },
      { id: "team-w", name: "west", region: "usw" },
    ]
  })

  it("directory marks the cookie's team active", async () => {
    cookieValue = "usw:team-w"
    const { activeTeamId, activeRegion } = await listTeamsAction()
    expect(activeTeamId).toBe("team-w")
    expect(activeRegion).toBe("usw")
  })

  it("directory falls back to the first team without a cookie", async () => {
    const { activeTeamId, activeRegion } = await listTeamsAction()
    expect(activeTeamId).toBe("team-a")
    expect(activeRegion).toBe("use")
  })

  it("setActiveTeamAction stores a verified membership", async () => {
    await setActiveTeamAction("team-w", "usw")
    expect(cookieSets).toEqual([
      { name: "ss-active-team", value: "usw:team-w" },
    ])
  })

  it("setActiveTeamAction rejects a team the user is not in", async () => {
    await expect(setActiveTeamAction("intruder", "usw")).rejects.toThrow(
      "not a member",
    )
    expect(cookieSets).toEqual([])
  })

  it("setActiveTeamAction requires the multi-cell UI allowlist", async () => {
    switchingAllowed = false
    await expect(setActiveTeamAction("team-w", "usw")).rejects.toThrow(
      "not enabled",
    )
    expect(cookieSets).toEqual([])
  })

  it("directory reports switching availability", async () => {
    switchingAllowed = false
    const { switchingEnabled } = await listTeamsAction()
    expect(switchingEnabled).toBe(false)
  })
})
