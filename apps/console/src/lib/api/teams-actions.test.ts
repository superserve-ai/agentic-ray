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

vi.mock("@/lib/api/team-directory", () => ({
  listTeamsForUser: async () => [],
}))

import { createTeamAction, listTeamsAction } from "./teams-actions"

describe("createTeamAction", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
    allowedRegions = null
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
