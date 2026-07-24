import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { PlatformBillingSummary } from "@/lib/admin/billing-actions"

import { PlatformBillingPage } from "./platform-billing-page"

const summary: PlatformBillingSummary = {
  period_start: "2026-07-01T00:00:00Z",
  period_end: "2026-08-01T00:00:00Z",
  current_charges_usd: 140,
  credits_applied_usd: 35,
  expected_invoice_amount_usd: 105,
  credits_remaining_usd: 95,
  rows: [
    {
      team_id: "team-lindy",
      team_name: "Lindy",
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
    {
      team_id: "team-phaser",
      team_name: "Phaser",
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
  ],
}

describe("PlatformBillingPage", () => {
  it("shows aggregate current-period totals and the usage breakdown", () => {
    render(<PlatformBillingPage summary={summary} />)
    expect(screen.getByText("Platform Billing")).toBeInTheDocument()
    expect(screen.getByText("$140.00")).toBeInTheDocument()
    expect(screen.getByText("$105.00")).toBeInTheDocument()
    expect(
      screen.getByText((_, element) => {
        const normalizedText = element?.textContent?.replace(/\s+/g, " ").trim()
        return (
          element?.tagName === "DIV" &&
          element.classList.contains("mt-1") &&
          normalizedText === "Compute $60.00 · Memory $30.00 · Storage $10.00"
        )
      }),
    ).toBeInTheDocument()
  })

  it("filters customers by name", () => {
    render(<PlatformBillingPage summary={summary} />)
    fireEvent.change(screen.getByLabelText("Filter customers by name"), {
      target: { value: "lindy" },
    })
    expect(screen.getByText("Lindy")).toBeInTheDocument()
    expect(screen.queryByText("Phaser")).not.toBeInTheDocument()
  })
})
