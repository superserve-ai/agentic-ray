import crypto from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationTeamId: async () => null,
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "a1", email: "amit@superserve.ai" } },
      }),
    },
  }),
}))

// Per-test knobs read lazily by the admin-client mock.
let homeRegionResult: { data: unknown; error: unknown } = {
  data: { home_region: "usw" },
  error: null,
}
let insertedApiKeyRow: Record<string, unknown> | null = null

// Minimal chainable stub: every builder method returns the chain; single()
// resolves to the configured result.
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "neq", "order", "limit", "update"]) {
    c[m] = () => c
  }
  c.single = async () => result
  return c
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      switch (table) {
        case "profile":
          return chain({ data: { id: "a1" }, error: null })
        case "team_member":
          return chain({ data: { team_id: "team-1" }, error: null })
        case "team":
          return chain(homeRegionResult)
        case "api_key": {
          const c = chain({
            data: { id: "k1", name: "test", created_at: "2026-07-01" },
            error: null,
          }) as Record<string, unknown> & {
            insert?: (row: Record<string, unknown>) => unknown
          }
          c.insert = (row: Record<string, unknown>) => {
            insertedApiKeyRow = row
            return c
          }
          return c
        }
        default:
          throw new Error(`unexpected table ${table}`)
      }
    },
  }),
}))

import { createApiKeyAction } from "./api-keys-actions"

describe("createApiKeyAction region-prefixed keys", () => {
  beforeEach(() => {
    insertedApiKeyRow = null
  })

  it("mints a key carrying the team's home region", async () => {
    homeRegionResult = { data: { home_region: "usw" }, error: null }
    const res = await createApiKeyAction("test")

    expect(res.key).toMatch(/^ss_live_usw_[A-Za-z0-9_-]{32}$/)
    // Exactly 8 random chars after the region segment.
    const randomPart = res.key.slice("ss_live_usw_".length)
    expect(res.prefix).toBe(`ss_live_usw_${randomPart.slice(0, 8)}...`)
    // Stored hash covers the full key string, region segment included.
    const wantHash = crypto.createHash("sha256").update(res.key).digest("hex")
    expect(insertedApiKeyRow?.key_hash).toBe(wantHash)
  })

  it("falls back to the default region when home_region is missing", async () => {
    // Simulates the column not existing yet (migration not applied).
    homeRegionResult = {
      data: null,
      error: { message: "column team.home_region does not exist" },
    }
    const res = await createApiKeyAction("test")
    expect(res.key).toMatch(/^ss_live_use_/)
  })

  it("falls back to the default region on an unknown region code", async () => {
    homeRegionResult = { data: { home_region: "mars" }, error: null }
    const res = await createApiKeyAction("test")
    expect(res.key).toMatch(/^ss_live_use_/)
  })
})
