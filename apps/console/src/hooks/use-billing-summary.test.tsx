import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"

import { useBillingSummary } from "./use-billing-summary"

const useBillingContext = vi.fn()
const getBillingSummary = vi.fn()

vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => useBillingContext(),
}))

vi.mock("@/lib/api/billing", () => ({
  getBillingSummary: (...args: unknown[]) => getBillingSummary(...args),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function BillingSummaryValue() {
  const { data, isPending } = useBillingSummary()

  return (
    <div>
      {isPending || !data
        ? "loading"
        : formatCurrency(data.current_charges_usd)}
    </div>
  )
}

describe("useBillingSummary", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    useBillingContext.mockReset()
    getBillingSummary.mockReset()
  })

  afterEach(() => {
    queryClient.clear()
  })

  it("drops Team A data immediately when switching to Team B and caches each team separately", async () => {
    const teamA = {
      current_charges_usd: 10,
      credits_applied_usd: 0,
      credits_remaining_usd: 0,
      expected_invoice_amount_usd: 10,
      cost_breakdown_usd: {
        compute: 6,
        memory: 3,
        storage: 1,
      },
      billing_period: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-07-01T00:00:00.000Z",
      },
      pricing_tier: {
        plan_key: "payg",
        plan_name: "Pay-as-you-go",
        currency: "USD",
      },
      calculated_at: "2026-06-16T00:00:00.000Z",
    } satisfies BillingSummaryResponse
    const teamB = {
      ...teamA,
      current_charges_usd: 25,
      expected_invoice_amount_usd: 25,
      cost_breakdown_usd: {
        compute: 15,
        memory: 7,
        storage: 3,
      },
    } satisfies BillingSummaryResponse

    const first = deferred<BillingSummaryResponse>()
    const second = deferred<BillingSummaryResponse>()

    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:team-a",
      ready: true,
    })
    getBillingSummary.mockImplementationOnce(() => first.promise)
    getBillingSummary.mockImplementationOnce(() => second.promise)

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <BillingSummaryValue />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(getBillingSummary).toHaveBeenCalledTimes(1))

    first.resolve(teamA)
    expect(await screen.findByText("$10.00")).toBeInTheDocument()

    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:team-b",
      ready: true,
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <BillingSummaryValue />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(screen.queryByText("$10.00")).not.toBeInTheDocument(),
    )
    expect(screen.getByText("loading")).toBeInTheDocument()

    second.resolve(teamB)
    expect(await screen.findByText("$25.00")).toBeInTheDocument()

    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual(
      expect.arrayContaining([
        ["billing", "summary", "self", "use:team-a"],
        ["billing", "summary", "self", "use:team-b"],
      ]),
    )
  })
})
