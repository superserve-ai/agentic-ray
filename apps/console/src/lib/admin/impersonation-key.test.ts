import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const upserts: Array<Record<string, unknown>> = []
const updates: Array<Record<string, unknown>> = []

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        upserts.push(row)
        return { error: null }
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (column: string, value: string) => {
          updates.push({ values, column, value })
          return { error: null }
        },
      }),
    }),
  })),
}))

import {
  ensureImpersonationKeyRow,
  IMPERSONATION_KEY_NAME,
  revokeImpersonationKeyRow,
} from "./impersonation-key"

describe("impersonation key rows", () => {
  const originalSecret = process.env.CONSOLE_PROXY_SECRET

  beforeEach(() => {
    process.env.CONSOLE_PROXY_SECRET =
      "test-secret-must-be-at-least-thirty-two-chars-long-abcdef"
    upserts.length = 0
    updates.length = 0
  })

  afterEach(() => {
    process.env.CONSOLE_PROXY_SECRET = originalSecret
  })

  it("persists the canonical impersonation key row with explicit scopes", async () => {
    const key = await ensureImpersonationKeyRow(
      "admin-1",
      "team-1",
      ["platform:sandbox:read", "platform:template:read"],
      7,
    )

    expect(key).toMatch(/^ss_live_/)
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      team_id: "team-1",
      name: IMPERSONATION_KEY_NAME,
      scopes: ["platform:sandbox:read", "platform:template:read"],
      created_by: "admin-1",
      revoked_at: null,
    })
    expect(typeof upserts[0].expires_at).toBe("string")
    expect(new Date(upserts[0].expires_at as string).getTime()).toBeGreaterThan(
      Date.now(),
    )
  })

  it("rejects empty scope lists", async () => {
    await expect(
      ensureImpersonationKeyRow("admin-1", "team-1", []),
    ).rejects.toThrow(/at least one read scope/)
    expect(upserts).toHaveLength(0)
  })

  it("revokes the impersonation key row", async () => {
    await ensureImpersonationKeyRow("admin-2", "team-2", [
      "platform:sandbox:read",
    ])
    await revokeImpersonationKeyRow("admin-2", "team-2")

    expect(upserts).toHaveLength(1)
    expect(updates).toEqual([
      {
        values: expect.objectContaining({
          revoked_at: expect.any(String),
        }),
        column: "key_hash",
        value: expect.any(String),
      },
    ])
  })
})
