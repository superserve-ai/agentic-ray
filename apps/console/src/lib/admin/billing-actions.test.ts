import { cookies, headers } from "next/headers"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))
vi.mock("@/lib/admin/staff", () => ({ isStaff: vi.fn() }))
vi.mock("@/lib/admin/permissions", async () => ({
  PLATFORM_BILLING_READ_PERMISSION: "platform:billing:read",
  canReadPlatformBilling: vi.fn(),
}))

import { canReadPlatformBilling } from "@/lib/admin/permissions"
import { isStaff } from "@/lib/admin/staff"
import { createServerClient } from "@/lib/supabase/server"

import { getPlatformBillingAction } from "./billing-actions"

const fetchSpy = vi.fn()

vi.stubGlobal("fetch", fetchSpy)

describe("getPlatformBillingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    } as never)
    vi.mocked(isStaff).mockReturnValue(true)
    vi.mocked(canReadPlatformBilling).mockReturnValue(true)
    vi.mocked(cookies).mockResolvedValue({
      getAll: () => [
        { name: "sb-access-token", value: "access" },
        { name: "sb-refresh-token", value: "refresh" },
      ],
    } as never)
    vi.mocked(headers).mockResolvedValue(
      new Headers({
        host: "console.superserve.ai",
        "x-forwarded-proto": "https",
      }),
    )
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: {
            current_charges_usd: 140,
            credits_applied_usd: 35,
            credits_remaining_usd: 95,
            expected_invoice_amount_usd: 105,
            teams: 2,
            succeeded: 1,
            failed: 1,
          },
          pagination: {
            limit: 25,
            offset: 25,
            total: 2,
          },
          rows: [
            {
              team_id: "team-pilot",
              team_name: "pilot-team",
              summary: {
                current_charges_usd: 100,
                credits_applied_usd: 25,
                credits_remaining_usd: 75,
                expected_invoice_amount_usd: 75,
                cost_breakdown_usd: {
                  compute: 60,
                  memory: 30,
                  storage: 10,
                },
                billing_period: {
                  start: "2026-07-01T00:00:00Z",
                  end: "2026-08-01T00:00:00Z",
                },
                pricing_tier: {
                  plan_key: "payg",
                  plan_name: "Pay as you go",
                  currency: "USD",
                },
                calculated_at: "2026-07-30T21:30:00Z",
              },
            },
            {
              team_id: "team-example",
              team_name: "example-team",
              summary: null,
              error: {
                code: "billing_cell_unreachable",
                message: "Cell use is temporarily unreachable",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    )
  })

  it("requires staff status and the platform billing permission", async () => {
    vi.mocked(isStaff).mockReturnValue(false)
    await expect(
      getPlatformBillingAction({
        page: 1,
        pageSize: 50,
        sort: "current_charges_usd",
        order: "desc",
      }),
    ).rejects.toThrow("platform billing read access required")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fetches the internal billing endpoint with an absolute console URL", async () => {
    const params = {
      page: 2,
      pageSize: 25,
      sort: "credits_remaining_usd",
      order: "asc",
      search: "pilot",
    } as const

    const response = await getPlatformBillingAction(params)

    expect(response).toMatchObject({
      totals: {
        current_charges_usd: 140,
        credits_applied_usd: 35,
        teams: 2,
        succeeded: 1,
        failed: 1,
      },
      pagination: {
        limit: 25,
        offset: 25,
        total: 2,
      },
    })
    expect(response.rows).toHaveLength(2)
    expect(response.rows[0]).toMatchObject({
      team_name: "pilot-team",
      summary: {
        pricing_tier: {
          plan_name: "Pay as you go",
        },
      },
    })
    expect(response.rows[1]).toMatchObject({
      team_name: "example-team",
      summary: null,
      error: {
        code: "billing_cell_unreachable",
      },
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://console.superserve.ai/api/internal/billing/?limit=25&offset=25&sort=credits_remaining_usd&order=asc&search=pilot",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    )

    const [, init] = fetchSpy.mock.calls[0]
    expect(init.headers).toEqual({
      cookie: "sb-access-token=access; sb-refresh-token=refresh",
    })
  })
})
