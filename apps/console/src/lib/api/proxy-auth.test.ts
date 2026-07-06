/**
 * proxy-auth — pure helpers and cell targeting.
 *
 * These are the security-critical primitives used by every authenticated
 * request through the API proxy. Tests focus on:
 *  - Deterministic key derivation (same user → same key across instances)
 *  - Different users → different keys
 *  - CONSOLE_PROXY_SECRET length guard
 *  - hashKey stability
 *  - Proxy key row / upstream URL resolving to the team's home cell
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock supabase clients so the proxy-auth module loads without a real
// connection. The pure helpers don't use them, but the module imports
// them at the top.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))

// The user's team lives in the usw cell — used by the cell-targeting tests.
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUser: vi.fn(async () => [
    { teamId: "team-west", region: "usw" },
  ]),
}))

const uswApiKeyUpserts: Array<Record<string, unknown>> = []
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  configuredRegions: () => ["use", "usw"],
  cellFor: (region: string) => ({
    region,
    apiBaseUrl: `https://api-${region}.test`,
    createAdminClient: () =>
      region === "usw"
        ? {
            // Captures the proxy key upsert.
            from: (table: string) => ({
              upsert: async (row: Record<string, unknown>) => {
                uswApiKeyUpserts.push({ table, ...row })
                return { error: null }
              },
            }),
          }
        : {
            // ensureProfile only reads: the profile already exists.
            from: () => ({
              select: () => ({
                eq: () => ({
                  single: async () => ({ data: { id: "u1" }, error: null }),
                }),
              }),
            }),
          },
  }),
}))

import {
  deriveRawKey,
  getApiBaseUrlForUser,
  getAuthApiKeyForUser,
  getProxySecret,
  hashKey,
} from "./proxy-auth"

const ORIGINAL_SECRET = process.env.CONSOLE_PROXY_SECRET

describe("proxy-auth.getProxySecret", () => {
  afterEach(() => {
    process.env.CONSOLE_PROXY_SECRET = ORIGINAL_SECRET
  })

  it("returns the secret when set and long enough", () => {
    process.env.CONSOLE_PROXY_SECRET = "x".repeat(32)
    expect(getProxySecret()).toBe("x".repeat(32))
  })

  it("throws when the secret is missing", () => {
    process.env.CONSOLE_PROXY_SECRET = undefined
    expect(() => getProxySecret()).toThrow(/at least 32 characters/)
  })

  it("throws when the secret is shorter than 32 chars", () => {
    process.env.CONSOLE_PROXY_SECRET = "short"
    expect(() => getProxySecret()).toThrow(/at least 32 characters/)
  })
})

describe("proxy-auth.deriveRawKey", () => {
  beforeEach(() => {
    process.env.CONSOLE_PROXY_SECRET =
      "test-secret-must-be-at-least-thirty-two-chars-long-abcdef"
  })

  it("is deterministic: same user id always returns the same key", () => {
    const k1 = deriveRawKey("user-123")
    const k2 = deriveRawKey("user-123")
    expect(k1).toBe(k2)
  })

  it("produces different keys for different user ids", () => {
    const k1 = deriveRawKey("user-a")
    const k2 = deriveRawKey("user-b")
    expect(k1).not.toBe(k2)
  })

  it("prefixes the key with ss_live_", () => {
    expect(deriveRawKey("user-123")).toMatch(/^ss_live_/)
  })

  it("uses base64url alphabet (safe for headers/URLs)", () => {
    const key = deriveRawKey("user-123")
    // base64url never uses +, /, or padding =
    expect(key).not.toMatch(/[+/=]/)
  })

  it("changes when the secret changes (force rotation)", () => {
    const a = deriveRawKey("user-123")
    process.env.CONSOLE_PROXY_SECRET =
      "different-secret-must-also-be-long-aaaaaaa"
    const b = deriveRawKey("user-123")
    expect(a).not.toBe(b)
  })
})

describe("proxy-auth.hashKey", () => {
  it("is stable for the same input", () => {
    expect(hashKey("ss_live_abc")).toBe(hashKey("ss_live_abc"))
  })

  it("returns a hex string of 64 chars (sha256)", () => {
    const h = hashKey("ss_live_abc")
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it("produces different hashes for different inputs", () => {
    expect(hashKey("a")).not.toBe(hashKey("b"))
  })
})

describe("proxy-auth cell targeting", () => {
  const user = { id: "cell-user", email: "pavitra@superserve.ai" }

  it("ensures the proxy key row in the team's home cell", async () => {
    const key = await getAuthApiKeyForUser(user as never)

    expect(key).toMatch(/^ss_live_/)
    expect(uswApiKeyUpserts).toEqual([
      {
        table: "api_key",
        team_id: "team-west",
        key_hash: hashKey(key as string),
        name: "__console_proxy__",
        scopes: [],
        created_by: "cell-user",
      },
    ])
  })

  it("resolves the proxy upstream to the team's home cell API", async () => {
    expect(await getApiBaseUrlForUser(user as never)).toBe(
      "https://api-usw.test",
    )
  })
})
