import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "./billing"

const apiClient = vi.fn()

vi.mock("./client", () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}))

describe("billing api", () => {
  beforeEach(() => {
    apiClient.mockReset()
  })

  it("loads the billing summary from the sandbox billing endpoint", async () => {
    const backendSummary = {
      billing_mode: "live",
      checkout_available: true,
      portal_available: true,
      payment_setup_required: false,
      permissions: {
        can_view: true,
        can_manage: true,
      },
      current_charges_usd: 12,
      credits_applied_usd: 5,
      credits_remaining_usd: 10,
      expected_invoice_amount_usd: 7,
      cost_breakdown_usd: {
        compute: 6,
        memory: 4,
        storage: 2,
      },
      resources: [
        {
          resource_key: "vcpu",
          resource: "cpu",
          display_name: "CPU",
          sort_order: 10,
          unit: "second",
          display_unit: "vCPU-hours",
          usage: 120,
          tracked: true,
          billable: true,
          charge_usd: 6,
        },
        {
          resource_key: "memory_gib",
          resource: "memory",
          display_name: "Memory",
          sort_order: 20,
          unit: "second",
          display_unit: "GiB-hours",
          usage: 2_048_000,
          tracked: true,
          billable: true,
          charge_usd: 4,
        },
        {
          resource_key: "storage_gib",
          resource: "storage",
          display_name: "Storage",
          sort_order: 30,
          unit: "second",
          display_unit: "GiB-hours",
          usage: 4_096_000,
          tracked: true,
          billable: false,
          charge_usd: 2,
        },
      ],
      billing_period: {
        start: "2026-06-01T12:00:00.000Z",
        end: "2026-07-01T12:00:00.000Z",
      },
      pricing_tier: {
        plan_key: "payg",
        plan_name: "Pay-as-you-go",
        currency: "USD",
      },
      calculated_at: "2026-06-30T12:00:00.000Z",
    } satisfies BillingSummaryResponse
    apiClient.mockResolvedValue(backendSummary)

    const { getBillingSummary } = await import("./billing")
    await expect(getBillingSummary()).resolves.toEqual(backendSummary)

    expect(apiClient).toHaveBeenCalledWith("/billing/summary", {
      cache: "no-store",
    })
  })
})
