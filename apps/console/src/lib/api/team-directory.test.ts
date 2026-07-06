import { beforeEach, describe, expect, it, vi } from "vitest"

// Per-test knobs read lazily by the cells mock.
let regions: string[] = ["use"]
let cellClients: Record<string, ReturnType<typeof cellClient>> = {}

// Minimal per-cell client: team_member memberships and team name lookups.
function cellClient(
  memberships: Array<{ team_id: string }>,
  teams: Array<{ id: string; name: string }> = [],
) {
  const from = vi.fn((table: string) => {
    if (table === "team_member") {
      return {
        select: () => ({
          eq: async () => ({ data: memberships, error: null }),
        }),
      }
    }
    if (table === "team") {
      return {
        select: () => ({
          in: async () => ({ data: teams, error: null }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from }
}

vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  configuredRegions: () => regions,
  cellFor: (region: string) => ({
    region,
    apiBaseUrl: `https://api-${region}.test`,
    createAdminClient: () => cellClients[region],
  }),
}))

import { listTeamMembershipsForUser, listTeamsForUser } from "./team-directory"

describe("team directory fan-out", () => {
  beforeEach(() => {
    regions = ["use"]
    cellClients = {}
  })

  it("reduces to the single default-cell query when only use is configured", async () => {
    cellClients.use = cellClient([{ team_id: "team-1" }])

    const memberships = await listTeamMembershipsForUser("u1")

    expect(memberships).toEqual([{ teamId: "team-1", region: "use" }])
    expect(cellClients.use.from).toHaveBeenCalledTimes(1)
  })

  it("merges memberships across cells, tagged with each cell's region", async () => {
    regions = ["use", "usw"]
    cellClients.use = cellClient([{ team_id: "team-1" }])
    cellClients.usw = cellClient([{ team_id: "team-west" }])

    const memberships = await listTeamMembershipsForUser("u1")

    expect(memberships).toEqual([
      { teamId: "team-1", region: "use" },
      { teamId: "team-west", region: "usw" },
    ])
  })

  it("returns an empty list when the user has no memberships anywhere", async () => {
    regions = ["use", "usw"]
    cellClients.use = cellClient([])
    cellClients.usw = cellClient([])

    expect(await listTeamMembershipsForUser("u1")).toEqual([])
  })

  it("lists teams with names from each cell for the directory", async () => {
    regions = ["use", "usw"]
    cellClients.use = cellClient(
      [{ team_id: "team-1" }],
      [{ id: "team-1", name: "east team" }],
    )
    cellClients.usw = cellClient(
      [{ team_id: "team-west" }],
      [{ id: "team-west", name: "west team" }],
    )

    const teams = await listTeamsForUser("u1")

    expect(teams).toEqual([
      { id: "team-1", name: "east team", region: "use" },
      { id: "team-west", name: "west team", region: "usw" },
    ])
  })

  it("skips the team lookup in cells without memberships", async () => {
    regions = ["use", "usw"]
    cellClients.use = cellClient(
      [{ team_id: "team-1" }],
      [{ id: "team-1", name: "east team" }],
    )
    cellClients.usw = cellClient([])

    const teams = await listTeamsForUser("u1")

    expect(teams).toEqual([{ id: "team-1", name: "east team", region: "use" }])
    // Only the membership query hit the empty cell.
    expect(cellClients.usw.from).toHaveBeenCalledTimes(1)
  })
})

describe("cell failure isolation", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
    cellClients = {}
  })

  // Shape-compatible with cellClient but every query fails; cast because the
  // success type pins error to null.
  function failingClient(message: string) {
    const from = vi.fn(() => ({
      select: () => ({
        eq: async () => ({ data: null, error: { message } }),
      }),
    }))
    return { from } as unknown as ReturnType<typeof cellClient>
  }

  it("serves the remaining cells when a secondary cell fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    cellClients.use = cellClient([{ team_id: "team-1" }])
    cellClients.usw = failingClient("usw pooler unreachable")

    const memberships = await listTeamMembershipsForUser("u1")

    expect(memberships).toEqual([{ teamId: "team-1", region: "use" }])
    expect(errSpy).toHaveBeenCalledOnce()
    errSpy.mockRestore()
  })

  it("still throws when the default cell fails", async () => {
    cellClients.use = failingClient("primary down")
    cellClients.usw = cellClient([{ team_id: "team-9" }])

    await expect(listTeamMembershipsForUser("u1")).rejects.toThrow(
      "primary down",
    )
  })

  it("isolates a secondary-cell failure in the team directory too", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    cellClients.use = cellClient(
      [{ team_id: "team-1" }],
      [{ id: "team-1", name: "Alpha" }],
    )
    cellClients.usw = failingClient("usw down")

    const teams = await listTeamsForUser("u1")

    expect(teams).toEqual([{ id: "team-1", name: "Alpha", region: "use" }])
    errSpy.mockRestore()
  })
})
