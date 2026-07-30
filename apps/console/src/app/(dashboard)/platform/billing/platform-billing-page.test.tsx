import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PlatformBillingSummary } from "@/lib/api/platform-billing"

const replace = vi.fn()
const searchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  usePathname: () => "/platform/billing",
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}))

import { PlatformBillingPage } from "./platform-billing-page"

const summary: PlatformBillingSummary = {
  totals: {
    current_charges_usd: 140,
    credits_applied_usd: 35,
    expected_invoice_amount_usd: 105,
    credits_remaining_usd: 95,
    teams: 2,
    succeeded: 1,
    failed: 1,
  },
  pagination: {
    limit: 1,
    offset: 0,
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
}

describe("PlatformBillingPage", () => {
  beforeEach(() => {
    replace.mockReset()
    searchParams.delete("search")
    searchParams.delete("page")
    searchParams.delete("size")
    searchParams.delete("sort")
    searchParams.delete("order")
  })

  it("shows aggregate totals and the current page rows", () => {
    render(
      <PlatformBillingPage
        summary={summary}
        page={1}
        pageSize={50}
        sort="current_charges_usd"
        order="desc"
        search=""
      />,
    )

    expect(screen.getByText("Platform Billing")).toBeInTheDocument()
    expect(screen.getByText("$140.00")).toBeInTheDocument()
    expect(screen.getByText("$105.00")).toBeInTheDocument()
    expect(screen.getByText(/1 succeeded/)).toBeInTheDocument()
    expect(screen.getByText("pilot-team")).toBeInTheDocument()
    expect(screen.getByText("example-team")).toBeInTheDocument()
    expect(screen.getAllByText(/Pay as you go/)).toHaveLength(2)
    expect(screen.getAllByText(/calculated/)).toHaveLength(2)
    expect(
      screen.getByText(
        "Billing unavailable: billing_cell_unreachable: Cell use is temporarily unreachable",
      ),
    ).toBeInTheDocument()
  })

  it("updates the URL when sorting, searching, and paginating", async () => {
    render(
      <PlatformBillingPage
        summary={summary}
        page={1}
        pageSize={1}
        sort="current_charges_usd"
        order="desc"
        search=""
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sort by Customer" }))
    expect(replace).toHaveBeenCalledWith(
      "/platform/billing?sort=team_name&order=asc",
    )

    replace.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(replace).toHaveBeenCalledWith("/platform/billing?page=2")

    replace.mockClear()
    fireEvent.change(screen.getByLabelText("Search customers..."), {
      target: { value: "pilot" },
    })

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/platform/billing?search=pilot")
    })
  })

  it("shows per-team error details when billing is unavailable", () => {
    render(
      <PlatformBillingPage
        summary={{
          ...summary,
          rows: [
            {
              ...summary.rows[0],
              summary: null,
              error: {
                code: "billing_cell_unreachable",
                message: "Cell use is temporarily unreachable",
              },
            },
          ],
          pagination: {
            ...summary.pagination,
            total: 1,
          },
        }}
        page={1}
        pageSize={50}
        sort="current_charges_usd"
        order="desc"
        search=""
      />,
    )

    expect(
      screen.getByText(
        "Billing unavailable: billing_cell_unreachable: Cell use is temporarily unreachable",
      ),
    ).toBeInTheDocument()
  })
})
