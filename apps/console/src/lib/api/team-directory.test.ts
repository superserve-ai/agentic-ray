import { beforeEach, describe, expect, it, vi } from "vitest"

// Per-test knobs read lazily by the cells mock.
let regions: string[] = ["use"]
let cellClients: Record<string, ReturnType<typeof cellClient>> = {}

// Minimal per-cell client: team_member memberships, team name lookups, and
// the sharded sandbox-count view.
function cellClient(
  memberships: Array<{ team_id: string }>,
  teams: Array<{ id: string; name: string; home_region?: string | null }> = [],
  rbac: Array<{ team_id: string; status: string }> = [],
  counts: Array<{ team_id: string; active_sandbox_count: number }> = [],
) {
  const from = vi.fn((table: string) => {
    if (table === "team_memberships") {
      return {
        select: () => ({
          eq: async () => ({ data: rbac, error: null }),
        }),
      }
    }
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
          eq: (_col: string, id: string) => ({
            limit: async () => ({
              data: teams.filter((t) => t.id === id),
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === "team_active_sandbox_counts") {
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({
              data: counts.find((c) => c.team_id === id) ?? null,
              error: null,
            }),
          }),
          in: async (_col: string, ids: string[]) => ({
            data: counts.filter((c) => ids.includes(c.team_id)),
            error: null,
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from }
}

function queuedMembershipCellClient(
  outcomes: Array<
    | { kind: "resolve"; data: Array<{ team_id: string }> }
    | { kind: "reject"; message: string }
  >,
) {
  const queue = [...outcomes]
  const from = vi.fn((table: string) => {
    if (table !== "team_memberships" && table !== "team_member") {
      throw new Error(`unexpected table ${table}`)
    }

    const next = queue.shift()
    if (!next) throw new Error(`unexpected ${table} call`)

    return {
      select: () => ({
        eq: async () => {
          if (next.kind === "reject") {
            return Promise.reject(new Error(next.message))
          }
          return { data: next.data, error: null }
        },
      }),
    }
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
import {
  clearMembershipDirectoryCache,
  findTeamById,
  listTeamMembershipsForUser,
  listTeamMembershipsForUserDetailed,
  listTeamsForUser,
  membershipExistsInCell,
} from "./team-directory"

// The membership directory caches per user id and tests reuse ids across
// cases with different mock data — every case starts cold.
beforeEach(() => {
  clearMembershipDirectoryCache()
})

describe("team directory fan-out", () => {
  beforeEach(() => {
    regions = ["use"]
    cellClients = {}
  })

  it("reduces to the single default-cell query when only use is configured", async () => {
    cellClients.use = cellClient([{ team_id: "team-1" }])

    const memberships = await listTeamMembershipsForUser("u1")

    expect(memberships).toEqual([{ teamId: "team-1", region: "use" }])
    // RBAC + legacy membership queries — still a single cell touched.
    expect(cellClients.use.from).toHaveBeenCalledTimes(2)
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
    // Only the membership queries hit the empty cell — no team lookup.
    expect(cellClients.usw.from).toHaveBeenCalledTimes(2)
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

  it("keeps a degraded empty read empty instead of fabricating membership state", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    regions = ["use", "usw"]
    cellClients.use = cellClient([])
    cellClients.usw = failingClient("usw pooler unreachable")

    const { memberships, degradedRegions } =
      await listTeamMembershipsForUserDetailed("u1", { maxAgeMs: 0 })

    expect(memberships).toEqual([])
    expect(degradedRegions).toEqual(["usw"])
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

describe("degradation visibility", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
    cellClients = {}
  })

  it("reports which secondary cells were dropped", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    cellClients.use = cellClient([{ team_id: "team-1" }])
    cellClients.usw = {
      from: vi.fn(() => ({
        select: () => ({
          eq: async () => ({ data: null, error: { message: "usw down" } }),
        }),
      })),
    } as unknown as ReturnType<typeof cellClient>

    const { memberships, degradedRegions } =
      await listTeamMembershipsForUserDetailed("u1")

    expect(memberships).toEqual([{ teamId: "team-1", region: "use" }])
    expect(degradedRegions).toEqual(["usw"])
    errSpy.mockRestore()
  })

  it("reports no degradation when every cell answers", async () => {
    cellClients.use = cellClient([{ team_id: "team-1" }])
    cellClients.usw = cellClient([])

    const { degradedRegions } = await listTeamMembershipsForUserDetailed("u1")

    expect(degradedRegions).toEqual([])
  })

  it("fails closed when a degraded read comes back empty", async () => {
    cellClients.use = cellClient([])
    cellClients.usw = cellClient([{ team_id: "team-west" }])

    await expect(listTeamMembershipsForUserDetailed("u1")).resolves.toEqual({
      memberships: [{ teamId: "team-west", region: "usw" }],
      degradedRegions: [],
    })

    cellClients.use = cellClient([])
    cellClients.usw = {
      from: vi.fn(() => ({
        select: () => ({
          eq: async () => ({ data: null, error: { message: "usw down" } }),
        }),
      })),
    } as unknown as ReturnType<typeof cellClient>

    await expect(
      listTeamMembershipsForUserDetailed("u1", { maxAgeMs: 0 }),
    ).resolves.toEqual({
      memberships: [],
      degradedRegions: ["usw"],
    })
  })

  it("drops the last known good snapshot after a later healthy empty read", async () => {
    cellClients.use = cellClient([])
    cellClients.usw = cellClient([{ team_id: "team-west" }])

    await expect(listTeamMembershipsForUserDetailed("u1")).resolves.toEqual({
      memberships: [{ teamId: "team-west", region: "usw" }],
      degradedRegions: [],
    })

    cellClients.use = cellClient([])
    cellClients.usw = cellClient([])

    await expect(
      listTeamMembershipsForUserDetailed("u1", { maxAgeMs: 0 }),
    ).resolves.toEqual({
      memberships: [],
      degradedRegions: [],
    })

    cellClients.use = cellClient([])
    cellClients.usw = {
      from: vi.fn(() => ({
        select: () => ({
          eq: async () => ({ data: null, error: { message: "usw down" } }),
        }),
      })),
    } as unknown as ReturnType<typeof cellClient>

    await expect(
      listTeamMembershipsForUserDetailed("u1", { maxAgeMs: 0 }),
    ).resolves.toEqual({
      memberships: [],
      degradedRegions: ["usw"],
    })
  })

  it("does not resurrect a cleared snapshot when forced-fresh reads overlap", async () => {
    regions = ["use", "usw"]
    cellClients.use = cellClient([{ team_id: "team-west" }])
    cellClients.usw = cellClient([])

    await listTeamMembershipsForUserDetailed("u1")

    cellClients.use = cellClient([])
    cellClients.usw = queuedMembershipCellClient([
      { kind: "resolve", data: [] },
      { kind: "resolve", data: [] },
      { kind: "reject", message: "usw down" },
      { kind: "resolve", data: [] },
    ])

    const [first, second] = await Promise.all([
      listTeamMembershipsForUserDetailed("u1", { maxAgeMs: 0 }),
      listTeamMembershipsForUserDetailed("u1", { maxAgeMs: 0 }),
    ])

    expect(first).toEqual({ memberships: [], degradedRegions: [] })
    expect(second).toEqual(first)
    expect(cellClients.use.from).toHaveBeenCalledTimes(4)
    expect(cellClients.usw.from).toHaveBeenCalledTimes(4)
  })
})

describe("RBAC-authoritative membership", () => {
  beforeEach(() => {
    regions = ["use"]
    cellClients = {}
  })

  it("denies a member whose RBAC membership is inactive, even with a legacy row", async () => {
    cellClients.use = cellClient(
      [{ team_id: "team-1" }],
      [],
      [{ team_id: "team-1", status: "inactive" }],
    )

    expect(await listTeamMembershipsForUser("u1")).toEqual([])
  })

  it("keeps a pure-legacy member with no RBAC row at all", async () => {
    cellClients.use = cellClient([{ team_id: "team-1" }], [], [])

    expect(await listTeamMembershipsForUser("u1")).toEqual([
      { teamId: "team-1", region: "use" },
    ])
  })

  it("accepts an active RBAC membership without a legacy row", async () => {
    cellClients.use = cellClient(
      [],
      [],
      [{ team_id: "team-2", status: "active" }],
    )

    expect(await listTeamMembershipsForUser("u1")).toEqual([
      { teamId: "team-2", region: "use" },
    ])
  })
})

describe("membership directory cache", () => {
  beforeEach(() => {
    regions = ["use"]
    cellClients = { use: cellClient([{ team_id: "t1" }]) }
  })

  it("serves repeat reads within the TTL from cache", async () => {
    await listTeamMembershipsForUserDetailed("u1")
    await listTeamMembershipsForUserDetailed("u1")
    expect(cellClients.use.from).toHaveBeenCalledTimes(2) // one fan-out: rbac + legacy
  })

  it("collapses concurrent reads into one fan-out", async () => {
    await Promise.all([
      listTeamMembershipsForUserDetailed("u1"),
      listTeamMembershipsForUserDetailed("u1"),
      listTeamMembershipsForUserDetailed("u1"),
    ])
    expect(cellClients.use.from).toHaveBeenCalledTimes(2)
  })

  it("maxAgeMs 0 always reads fresh", async () => {
    await listTeamMembershipsForUserDetailed("u1")
    await listTeamMembershipsForUserDetailed("u1", { maxAgeMs: 0 })
    expect(cellClients.use.from).toHaveBeenCalledTimes(4)
  })

  it("does not share entries across users", async () => {
    await listTeamMembershipsForUserDetailed("u1")
    await listTeamMembershipsForUserDetailed("u2")
    expect(cellClients.use.from).toHaveBeenCalledTimes(4)
  })

  it("invalidateMembershipDirectory forces the next read to fetch", async () => {
    const { invalidateMembershipDirectory } = await import("./team-directory")
    await listTeamMembershipsForUserDetailed("u1")
    invalidateMembershipDirectory("u1")
    await listTeamMembershipsForUserDetailed("u1")
    expect(cellClients.use.from).toHaveBeenCalledTimes(4)
  })

  it("does not cache failures", async () => {
    const failing = {
      from: vi.fn(() => {
        throw new Error("cell down")
      }),
    }
    cellClients = { use: failing as unknown as ReturnType<typeof cellClient> }
    await expect(listTeamMembershipsForUserDetailed("u1")).rejects.toThrow()
    cellClients = { use: cellClient([{ team_id: "t1" }]) }
    const result = await listTeamMembershipsForUserDetailed("u1")
    expect(result.memberships).toEqual([{ teamId: "t1", region: "use" }])
  })
})

describe("membershipExistsInCell", () => {
  it("checks only the named cell and honors RBAC precedence", async () => {
    regions = ["use", "usw"]
    cellClients = {
      use: cellClient([{ team_id: "t-legacy" }]),
      usw: cellClient([], [], [{ team_id: "t-west", status: "active" }]),
    }
    expect(await membershipExistsInCell("usw", "u1", "t-west")).toBe(true)
    expect(await membershipExistsInCell("usw", "u1", "t-legacy")).toBe(false)
    expect(cellClients.use.from).not.toHaveBeenCalled()
  })

  it("denies an inactive RBAC membership even with a legacy row", async () => {
    regions = ["use"]
    cellClients = {
      use: cellClient(
        [{ team_id: "t1" }],
        [],
        [{ team_id: "t1", status: "inactive" }],
      ),
    }
    expect(await membershipExistsInCell("use", "u1", "t1")).toBe(false)
  })
})

describe("findTeamById home-region preference", () => {
  // After a cross-cell migration the team id exists in two cells: the live
  // row in its new home and a detached pointer row in the old cell whose
  // home_region names the new home. The lookup must return the home row.
  const team = (home_region: string | null) => ({
    id: "t-1",
    name: "acme",
    max_sandboxes: 10,
    created_at: "2026-01-01",
    home_region,
  })

  it("reads the sandbox count from the sharded-counter view, defaulting to zero", async () => {
    regions = ["use"]
    cellClients = {
      use: cellClient(
        [],
        [team(null)],
        [],
        [{ team_id: "t-1", active_sandbox_count: 7 }],
      ),
    }
    expect((await findTeamById("t-1"))?.active_sandbox_count).toBe(7)

    cellClients = { use: cellClient([], [team(null)]) }
    clearMembershipDirectoryCache()
    expect((await findTeamById("t-1"))?.active_sandbox_count).toBe(0)
  })

  it("prefers the cell the team names as home over an earlier pointer row", async () => {
    regions = ["use", "usw"]
    cellClients = {
      use: cellClient([], [team("usw")]),
      usw: cellClient([], [team("usw")]),
    }
    const found = await findTeamById("t-1")
    expect(found?.region).toBe("usw")
  })

  it("falls back to the pointer row when the home row is missing", async () => {
    regions = ["use", "usw"]
    cellClients = {
      use: cellClient([], [team("usw")]),
      usw: cellClient([], []),
    }
    const found = await findTeamById("t-1")
    expect(found?.region).toBe("use")
  })

  it("returns a row whose home_region is unset (pre-migration schema)", async () => {
    regions = ["use", "usw"]
    cellClients = {
      use: cellClient([], [team(null)]),
      usw: cellClient([], []),
    }
    const found = await findTeamById("t-1")
    expect(found?.region).toBe("use")
  })

  const downCell = (message: string) =>
    ({
      from: vi.fn(() => {
        throw new Error(message)
      }),
    }) as unknown as ReturnType<typeof cellClient>

  it("serves the pointer row when the home cell is down", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    regions = ["use", "usw"]
    cellClients = {
      use: cellClient([], [team("usw")]),
      usw: downCell("usw pooler unreachable"),
    }
    const found = await findTeamById("t-1")
    expect(found?.region).toBe("use")
    expect(errSpy).toHaveBeenCalledOnce()
    errSpy.mockRestore()
  })

  it("still throws when the default cell fails during the lookup", async () => {
    regions = ["use", "usw"]
    cellClients = {
      use: downCell("primary down"),
      usw: cellClient([], [team("usw")]),
    }
    await expect(findTeamById("t-1")).rejects.toThrow("primary down")
  })

  it("ignores a pointer row whose home cell is not configured", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    regions = ["use"]
    cellClients = {
      use: cellClient([], [team("usw")]),
    }
    expect(await findTeamById("t-1")).toBeNull()
    expect(errSpy).toHaveBeenCalledOnce()
    errSpy.mockRestore()
  })
})
