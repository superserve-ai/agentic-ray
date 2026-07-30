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
  },
  pagination: {
    page: 1,
    page_size: 1,
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
    {
      team_id: "team-example",
      team_name: "example-team",
      summary: {
        region: "use",
        current_charges_usd: 40,
        credits_applied_usd: 10,
        credits_remaining_usd: 20,
        expected_invoice_amount_usd: 30,
        compute_usd: 20,
        memory_usd: 15,
        storage_usd: 5,
        billing_period_start: "2026-07-01T00:00:00Z",
        billing_period_end: "2026-08-01T00:00:00Z",
        billing_mode: "active",
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
    expect(screen.getByText("pilot-team")).toBeInTheDocument()
    expect(screen.getByText("example-team")).toBeInTheDocument()
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
              summary: {
                ...summary.rows[0].summary,
                billing_mode: "unavailable",
              },
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
