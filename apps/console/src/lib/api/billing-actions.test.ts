import { beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()
const from = vi.fn()
const rpc = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    auth: {
      getUser,
    },
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from,
    rpc,
  })),
}))

// No cookie set: active-team resolution falls back to the first membership.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}))

function featureFlagResult(enabled: boolean) {
  return Promise.resolve({ data: enabled, error: null })
}

function singleTeamResult(teamIds: string[] = ["team-1"]) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(async () => ({
        data: teamIds.map((team_id) => ({ team_id })),
        error: null,
      })),
    })),
  }
}

function teamPricingPlanQuery() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        lte: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({
              data: [
                {
                  plan_key: "inactive-plan",
                  effective_from: "2026-01-02T00:00:00.000Z",
                  effective_to: null,
                },
                {
                  plan_key: "custom-plan",
                  effective_from: "2026-01-01T00:00:00.000Z",
                  effective_to: null,
                },
              ],
              error: null,
            })),
          })),
        })),
      })),
    })),
  }
}

function pricingPlanQuery() {
  return {
    select: vi.fn(() => ({
      in: vi.fn(() => ({
        eq: vi.fn(async () => ({
          data: [{ key: "custom-plan" }],
          error: null,
        })),
      })),
    })),
  }
}

function pricingRateQuery() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        lte: vi.fn(async () => ({
          data: [
            {
              resource: "vcpu",
              unit: "second",
              price_usd: "0.000010",
              effective_from: "2026-01-01T00:00:00.000Z",
              effective_to: null,
              created_at: "2026-01-01T00:00:00.000Z",
              id: "old-vcpu",
            },
            {
              resource: "vcpu",
              unit: "second",
              price_usd: "0.000020",
              effective_from: "2026-01-02T00:00:00.000Z",
              effective_to: null,
              created_at: "2026-01-02T00:00:00.000Z",
              id: "new-vcpu",
            },
            {
              resource: "memory_gib",
              unit: "second",
              price_usd: "0.000004",
              effective_from: "2026-01-01T00:00:00.000Z",
              effective_to: null,
              created_at: "2026-01-01T00:00:00.000Z",
              id: "memory",
            },
            {
              resource: "storage_gib",
              unit: "second",
              price_usd: "0.00000003",
              effective_from: "2026-01-01T00:00:00.000Z",
              effective_to: null,
              created_at: "2026-01-01T00:00:00.000Z",
              id: "storage",
            },
          ],
          error: null,
        })),
      })),
    })),
  }
}

function usageQuery(rows: Array<Record<string, unknown>> = []) {
  const order = vi.fn(async () => ({ data: rows, error: null }))
  const lt = vi.fn(() => ({ order }))
  const gte = vi.fn(() => ({ lt }))
  const eq = vi.fn(() => ({ gte }))
  return {
    select: vi.fn(() => ({ eq })),
  }
}

describe("billing actions", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    rpc.mockImplementation((_name, args) => {
      if (args.flag_key === "tenant_usage_dashboard") {
        return featureFlagResult(true)
      }
      if (args.flag_key === "billing_metrics_write") {
        return featureFlagResult(true)
      }
      if (args.flag_key === "billing_export_enabled") {
        return featureFlagResult(false)
      }
      return featureFlagResult(false)
    })
    from.mockImplementation((table: string) => {
      if (table === "team_memberships")
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        }
      if (table === "team_member") return singleTeamResult()
      if (table === "team_pricing_plan") return teamPricingPlanQuery()
      if (table === "pricing_plan") return pricingPlanQuery()
      if (table === "pricing_rate") return pricingRateQuery()
      if (table === "team_billing_usage_hourly") return usageQuery()
      throw new Error(`unexpected table ${table}`)
    })
  })

  it("uses the active team pricing plan and newest active rate", async () => {
    const { getBillingUsageAction } = await import("./billing-actions")

    const response = await getBillingUsageAction(
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    )

    expect(response.enabled).toBe(true)
    expect(response.billing_mode).toBe("shadow")
    expect(response.pricing?.source).toBe("api")
    expect(response.pricing?.cpu_vcpu_hour_usd).toBeCloseTo(0.072)
    expect(response.pricing?.memory_gib_hour_usd).toBeCloseTo(0.0144)
    expect(response.pricing?.storage_gib_hour_usd).toBeCloseTo(0.000108)
  })

  it("does not return pricing when usage dashboard is disabled", async () => {
    rpc.mockImplementation((_name, args) => {
      if (args.flag_key === "tenant_usage_dashboard") {
        return featureFlagResult(false)
      }
      return featureFlagResult(true)
    })
    const { getBillingUsageAction } = await import("./billing-actions")

    const response = await getBillingUsageAction(
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    )

    expect(response).toMatchObject({
      enabled: false,
      billing_mode: "disabled",
      rows: [],
    })
    expect(response.pricing).toBeUndefined()
  })

  it("returns shadow usage when writes are enabled but billing export is disabled", async () => {
    const { getBillingUsageAction } = await import("./billing-actions")

    const response = await getBillingUsageAction(
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    )

    expect(response.billing_mode).toBe("shadow")
    expect(response.pricing).toBeDefined()
  })

  it("returns active usage when billing export is enabled", async () => {
    rpc.mockImplementation((_name, args) => {
      if (args.flag_key === "tenant_usage_dashboard") {
        return featureFlagResult(true)
      }
      if (args.flag_key === "billing_metrics_write") {
        return featureFlagResult(true)
      }
      if (args.flag_key === "billing_export_enabled") {
        return featureFlagResult(true)
      }
      return featureFlagResult(false)
    })
    const { getBillingUsageAction } = await import("./billing-actions")

    const response = await getBillingUsageAction(
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    )

    expect(response.billing_mode).toBe("active")
  })
})
