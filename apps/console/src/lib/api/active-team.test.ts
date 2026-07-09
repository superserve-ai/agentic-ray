import { describe, expect, it, vi } from "vitest"

// Cookie store stub — swapped per test via cookieValue.
let cookieValue: string | undefined
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "ss-active-team" && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
  }),
}))

let memberships: Array<{ teamId: string; region: string }> = []
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUser: vi.fn(async () => memberships),
}))

import {
  parseTeamSelection,
  pickActiveTeam,
  resolveActiveTeam,
  serializeTeamSelection,
} from "./active-team"

describe("parseTeamSelection", () => {
  it("splits region and team id at the first colon", () => {
    expect(parseTeamSelection("usw:team-1")).toEqual({
      region: "usw",
      teamId: "team-1",
    })
  })

  it("round-trips through serializeTeamSelection", () => {
    const selection = { region: "use", teamId: "abc-123" }
    expect(parseTeamSelection(serializeTeamSelection(selection))).toEqual(
      selection,
    )
  })

  it("rejects missing, empty, and one-sided values", () => {
    expect(parseTeamSelection(undefined)).toBeNull()
    expect(parseTeamSelection("")).toBeNull()
    expect(parseTeamSelection("no-colon")).toBeNull()
    expect(parseTeamSelection(":team-1")).toBeNull()
    expect(parseTeamSelection("usw:")).toBeNull()
  })
})

describe("pickActiveTeam", () => {
  const west = { teamId: "team-w", region: "usw" }
  const eastA = { teamId: "team-a", region: "use" }
  const eastB = { teamId: "team-b", region: "use" }

  it("returns the selected team when it matches a membership", () => {
    expect(
      pickActiveTeam([eastA, west], { region: "usw", teamId: "team-w" }),
    ).toBe(west)
  })

  it("requires region AND id to match (same id can exist in two cells mid-migration)", () => {
    const mirrored = { teamId: "team-w", region: "use" }
    expect(
      pickActiveTeam([mirrored, west], { region: "usw", teamId: "team-w" }),
    ).toBe(west)
  })

  it("falls back when the selection is not a live membership", () => {
    expect(pickActiveTeam([eastA], { region: "usw", teamId: "gone" })).toBe(
      eastA,
    )
  })

  it("fallback is deterministic regardless of within-cell row order", () => {
    expect(pickActiveTeam([eastB, eastA], null)).toBe(eastA)
    expect(pickActiveTeam([eastA, eastB], null)).toBe(eastA)
  })

  it("fallback keeps cell order: default cell beats secondary cells", () => {
    // A global id sort would pick team-a in usw; cell order must win instead.
    const eastZ = { teamId: "team-z", region: "use" }
    const westA = { teamId: "team-a", region: "usw" }
    expect(pickActiveTeam([eastZ, westA], null)).toBe(eastZ)
    expect(pickActiveTeam([west], null)).toBe(west)
  })

  it("returns null with no memberships", () => {
    expect(pickActiveTeam([], null)).toBeNull()
    expect(pickActiveTeam([], { region: "use", teamId: "x" })).toBeNull()
  })
})

describe("resolveActiveTeam", () => {
  it("honors the cookie when it matches a membership", async () => {
    memberships = [
      { teamId: "team-a", region: "use" },
      { teamId: "team-w", region: "usw" },
    ]
    cookieValue = "usw:team-w"
    expect(await resolveActiveTeam("u1")).toEqual({
      teamId: "team-w",
      region: "usw",
    })
  })

  it("falls back to the first membership without a cookie", async () => {
    memberships = [
      { teamId: "team-a", region: "use" },
      { teamId: "team-w", region: "usw" },
    ]
    cookieValue = undefined
    expect(await resolveActiveTeam("u1")).toEqual({
      teamId: "team-a",
      region: "use",
    })
  })

  it("ignores a stale cookie for a revoked membership", async () => {
    memberships = [{ teamId: "team-a", region: "use" }]
    cookieValue = "usw:team-w"
    expect(await resolveActiveTeam("u1")).toEqual({
      teamId: "team-a",
      region: "use",
    })
  })
})
