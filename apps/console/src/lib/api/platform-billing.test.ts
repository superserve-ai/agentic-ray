import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PlatformBillingSummary } from "./platform-billing"

const apiClient = vi.fn()

vi.mock("./client", () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}))

describe("platform billing api", () => {
  beforeEach(() => {
    apiClient.mockReset()
  })

  it("loads the platform billing page from the platform billing endpoint", async () => {
    const backendSummary = {
      period_start: "2026-07-01T00:00:00Z",
      period_end: "2026-08-01T00:00:00Z",
      current_charges_usd: 140,
      credits_applied_usd: 35,
      credits_remaining_usd: 95,
      expected_invoice_amount_usd: 105,
      total: 2,
      rows: [],
    } satisfies PlatformBillingSummary
    apiClient.mockResolvedValue(backendSummary)

    const { listPlatformBillingPaged } = await import("./platform-billing")
    await expect(
      listPlatformBillingPaged({
        page: 2,
        pageSize: 25,
        sort: "team_name",
        order: "asc",
        q: "lindy",
      }),
    ).resolves.toEqual(backendSummary)

    expect(apiClient).toHaveBeenCalledWith(
      "/platform/billing?limit=25&offset=25&sort=team_name&order=asc&q=lindy",
    )
  })
})
