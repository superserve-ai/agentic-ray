import { describe, expect, it } from "vitest"

import {
  platformBillingListQuery,
  type PlatformBillingSummary,
} from "./platform-billing"

describe("platform billing api", () => {
  it("builds the internal billing list query from page params", () => {
    expect(
      platformBillingListQuery({
        page: 2,
        pageSize: 25,
        sort: "team_name",
        order: "asc",
        search: "pilot",
      }),
    ).toBe("limit=25&offset=25&sort=team_name&order=asc&search=pilot")
  })

  it("accepts the nested billing response contract", () => {
    const response = {
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
    } satisfies PlatformBillingSummary

    expect(response.rows[0]?.summary?.pricing_tier.plan_name).toBe(
      "Pay as you go",
    )
    expect(response.rows[1]?.summary).toBeNull()
    expect(response.pagination.total).toBe(2)
  })
})
