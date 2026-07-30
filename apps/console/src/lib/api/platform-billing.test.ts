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
      },
      pagination: {
        page: 2,
        page_size: 25,
        total: 2,
      },
      rows: [
        {
          team_id: "team-pilot",
          team_name: "pilot-team",
          summary: {
            region: "use",
            current_charges_usd: 100,
            credits_applied_usd: 25,
            credits_remaining_usd: 75,
            expected_invoice_amount_usd: 75,
            compute_usd: 60,
            memory_usd: 30,
            storage_usd: 10,
            billing_period_start: "2026-07-01T00:00:00Z",
            billing_period_end: "2026-08-01T00:00:00Z",
            billing_mode: "active",
          },
        },
      ],
    } satisfies PlatformBillingSummary

    expect(response.rows[0]?.summary.billing_mode).toBe("active")
    expect(response.pagination.total).toBe(2)
  })
})
