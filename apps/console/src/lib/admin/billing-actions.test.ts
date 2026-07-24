import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))
vi.mock("@/lib/admin/staff", () => ({ isStaff: vi.fn() }))
vi.mock("@/lib/admin/permissions", async () => ({
  PLATFORM_BILLING_READ_PERMISSION: "platform:billing:read",
  canReadPlatformBilling: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation-key", () => ({
  ensureImpersonationKeyRow: vi.fn(),
}))
vi.mock("@/lib/api/team-directory", () => ({ listAllTeams: vi.fn() }))
vi.mock("@/lib/cells", () => ({
  cellFor: vi.fn(() => ({ apiBaseUrl: "https://api.test" })),
}))

import { ensureImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import { canReadPlatformBilling } from "@/lib/admin/permissions"
import { isStaff } from "@/lib/admin/staff"
import { listAllTeams } from "@/lib/api/team-directory"
import { createServerClient } from "@/lib/supabase/server"

import { getPlatformBillingAction } from "./billing-actions"

const teams = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Lindy",
    region: "use",
    active_sandbox_count: 2,
    max_sandboxes: 10,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Phaser",
    region: "use",
    active_sandbox_count: 1,
    max_sandboxes: 10,
    created_at: "2026-01-02T00:00:00Z",
  },
]

function responseFor(teamId: string) {
  const lindy = teamId === teams[0].id
  return {
    current_charges_usd: lindy ? 100 : 40,
    credits_applied_usd: lindy ? 25 : 10,
    credits_remaining_usd: lindy ? 75 : 20,
    expected_invoice_amount_usd: lindy ? 75 : 30,
    cost_breakdown_usd: lindy
      ? { compute: 60, memory: 30, storage: 10 }
      : { compute: 20, memory: 15, storage: 5 },
    billing_period: {
      start: "2026-07-01T00:00:00Z",
      end: "2026-08-01T00:00:00Z",
    },
    pricing_tier: { plan_key: "payg", plan_name: "PAYG", currency: "USD" },
    calculated_at: "2026-07-24T12:00:00Z",
  }
}

describe("getPlatformBillingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = new URL(String(input))
        return new Response(
          JSON.stringify(responseFor(url.searchParams.get("team_id") ?? "")),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }),
    )
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    } as never)
    vi.mocked(isStaff).mockReturnValue(true)
    vi.mocked(canReadPlatformBilling).mockReturnValue(true)
    vi.mocked(listAllTeams).mockResolvedValue(teams)
    vi.mocked(ensureImpersonationKeyRow).mockResolvedValue("ss_live_test")
  })

  it("aggregates current-period usage and credits across customers", async () => {
    const result = await getPlatformBillingAction()

    expect(result.current_charges_usd).toBe(140)
    expect(result.credits_applied_usd).toBe(35)
    expect(result.expected_invoice_amount_usd).toBe(105)
    expect(result.credits_remaining_usd).toBe(95)
    expect(result.rows.map((row) => row.team_name)).toEqual(["Lindy", "Phaser"])
    expect(result.rows[0].compute_usd).toBe(60)
  })

  it("requires staff status and the platform billing permission", async () => {
    vi.mocked(isStaff).mockReturnValue(false)
    await expect(getPlatformBillingAction()).rejects.toThrow(
      "platform billing read access required",
    )
    expect(listAllTeams).not.toHaveBeenCalled()
  })

  it("keeps other customers visible when one billing summary fails", async () => {
    vi.mocked(fetch).mockImplementation(async (input: URL | RequestInfo) => {
      const url = new URL(String(input))
      if (url.searchParams.get("team_id") === teams[1].id) {
        return new Response(null, { status: 503 })
      }
      return new Response(JSON.stringify(responseFor(teams[0].id)), {
        status: 200,
      })
    })

    const result = await getPlatformBillingAction()
    expect(result.current_charges_usd).toBe(100)
    expect(
      result.rows.find((row) => row.team_name === "Phaser")?.billing_mode,
    ).toBe("unavailable")
  })
})
