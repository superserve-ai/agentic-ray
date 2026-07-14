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

import { provisionTeam } from "./team-provisioning"

describe("provisionTeam", () => {
  beforeEach(() => {
    clients = { use: recordingClient(), usw: recordingClient() }
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
  })
})
