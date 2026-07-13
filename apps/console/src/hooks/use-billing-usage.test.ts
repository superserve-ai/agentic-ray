import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const useQuery = vi.fn((config) => config)
const useBillingContext = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery,
}))

vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => useBillingContext(),
}))

vi.mock("@/lib/api/billing-actions", () => ({
  getBillingSettingsAction: vi.fn(),
  getBillingUsageAction: vi.fn(),
}))

describe("useBillingUsage", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useQuery.mockClear()
    useBillingContext.mockReset()
    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:team-a",
      ready: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("polls recent ranges every minute", async () => {
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"))
    const { useBillingUsage } = await import("./use-billing-usage")

    useBillingUsage(
      new Date("2026-01-02T00:00:00.000Z"),
      new Date("2026-01-02T23:30:00.000Z"),
    )

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        staleTime: 30_000,
        refetchInterval: 60_000,
        queryKey: [
          "billing",
          "usage",
          "self",
          "use:team-a",
          "2026-01-02T00:00:00.000Z",
          "2026-01-02T23:30:00.000Z",
        ],
      }),
    )
    vi.useRealTimers()
  })

  it("caches historical ranges without polling", async () => {
    useQuery.mockClear()
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"))
    const { useBillingUsage } = await import("./use-billing-usage")

    useBillingUsage(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T12:00:00.000Z"),
    )

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        staleTime: 30 * 60_000,
        refetchInterval: false,
        queryKey: [
          "billing",
          "usage",
          "self",
          "use:team-a",
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T12:00:00.000Z",
        ],
      }),
    )
    vi.useRealTimers()
  })

  it("changes the billing usage cache key when teams switch", async () => {
    const { useBillingUsage } = await import("./use-billing-usage")

    useBillingUsage(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T12:00:00.000Z"),
    )

    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:team-b",
      ready: true,
    })

    useBillingUsage(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T12:00:00.000Z"),
    )

    expect(useQuery.mock.calls[0]?.[0].queryKey).toEqual([
      "billing",
      "usage",
      "self",
      "use:team-a",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T12:00:00.000Z",
    ])
    expect(useQuery.mock.calls[1]?.[0].queryKey).toEqual([
      "billing",
      "usage",
      "self",
      "use:team-b",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T12:00:00.000Z",
    ])
  })
})
