import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "u1", email: "pavitra@superserve.ai" } },
      }),
    },
  }),
}))

// No cookie set: active-team resolution falls back to the first membership.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}))

let uswProfileChecked = false
let insertedApiKeyRow: Record<string, unknown> | null = null

// Default cell: the user's profile exists, but their team lives elsewhere.
const useClient = {
  from: vi.fn((table: string) => {
    if (table === "profile") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { id: "u1" }, error: null }),
          }),
        }),
      }
    }
    if (table === "team_memberships") {
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      }
    }
    if (table === "team_member") {
      return {
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
      }
    }
    throw new Error(`unexpected table ${table} in use cell`)
  }),
}

// usw cell: holds the membership, the team row, and receives the key insert.
const uswClient = {
  from: vi.fn((table: string) => {
    if (table === "team_memberships") {
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      }
    }
    if (table === "team_member") {
      return {
        select: () => ({
          eq: async () => ({ data: [{ team_id: "team-west" }], error: null }),
        }),
      }
    }
    if (table === "team") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { home_region: "usw" },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === "profile") {
      // ensureProfile now runs in the team's cell before the key insert —
      // report the profile as present so the write path proceeds.
      uswProfileChecked = true
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { id: "u1" }, error: null }),
          }),
        }),
      }
    }
    if (table === "api_key") {
      return {
        insert: (row: Record<string, unknown>) => {
          insertedApiKeyRow = row
          return {
            select: () => ({
              single: async () => ({
                data: { id: "k1", name: "test", created_at: "2026-07-01" },
                error: null,
              }),
            }),
          }
        },
      }
    }
    throw new Error(`unexpected table ${table} in usw cell`)
  }),
}

vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  configuredRegions: () => ["use", "usw"],
  cellFor: (region: string) => ({
    region,
    apiBaseUrl: `https://api-${region}.test`,
    createAdminClient: () => (region === "usw" ? uswClient : useClient),
  }),
}))

import { createApiKeyAction } from "./api-keys-actions"

describe("createApiKeyAction cell targeting", () => {
  it("writes the key row to the team's home cell", async () => {
    const res = await createApiKeyAction("test")

    expect(res.key).toMatch(/^ss_live_usw_/)
    expect(uswProfileChecked).toBe(true)
    expect(insertedApiKeyRow).toMatchObject({
      team_id: "team-west",
      name: "test",
      created_by: "u1",
    })
    // The default cell only saw the profile check and membership fan-out.
    const useTables = useClient.from.mock.calls.map(([table]) => table)
    expect(useTables).not.toContain("api_key")
  })
})
