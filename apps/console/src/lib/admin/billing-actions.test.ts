import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))
vi.mock("@/lib/admin/staff", () => ({ isStaff: vi.fn() }))
vi.mock("@/lib/admin/permissions", async () => ({
  PLATFORM_BILLING_READ_PERMISSION: "platform:billing:read",
  canReadPlatformBilling: vi.fn(),
}))
vi.mock("@/lib/api/platform-billing", () => ({
  listPlatformBillingPaged: vi.fn(),
}))

import { canReadPlatformBilling } from "@/lib/admin/permissions"
import { isStaff } from "@/lib/admin/staff"
import { listPlatformBillingPaged } from "@/lib/api/platform-billing"
import { createServerClient } from "@/lib/supabase/server"

import { getPlatformBillingAction } from "./billing-actions"

describe("getPlatformBillingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    } as never)
    vi.mocked(isStaff).mockReturnValue(true)
    vi.mocked(canReadPlatformBilling).mockReturnValue(true)
    vi.mocked(listPlatformBillingPaged).mockResolvedValue({
      period_start: "2026-07-01T00:00:00Z",
      period_end: "2026-08-01T00:00:00Z",
      current_charges_usd: 140,
      credits_applied_usd: 35,
      credits_remaining_usd: 95,
      expected_invoice_amount_usd: 105,
      total: 2,
      rows: [],
    })
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
    expect(listPlatformBillingPaged).not.toHaveBeenCalled()
  })

  it("forwards the paging params to the platform billing endpoint", async () => {
    const params = {
      page: 2,
      pageSize: 25,
      sort: "credits_remaining_usd",
      order: "asc",
      q: "lindy",
    } as const

    await expect(getPlatformBillingAction(params)).resolves.toMatchObject({
      total: 2,
      current_charges_usd: 140,
    })
    expect(listPlatformBillingPaged).toHaveBeenCalledWith(params)
  })
})
