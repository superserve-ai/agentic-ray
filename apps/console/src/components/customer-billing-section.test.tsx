import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"

import { CustomerBillingSection } from "./customer-billing-section"

const useCustomerBillingPeriods = vi.fn()
const createStripeCheckoutSession = vi.fn()
const createStripeCustomerPortalSession = vi.fn()
const addToast = vi.fn()

const baseSummary: BillingSummaryResponse = {
  billing_mode: "live" as const,
  checkout_available: true,
  portal_available: true,
  payment_setup_required: false,
  permissions: {
    can_view: true,
    can_manage: true,
  },
  current_charges_usd: 123.45,
  credits_applied_usd: 23.45,
  credits_remaining_usd: 76.55,
  expected_invoice_amount_usd: 100,
  cost_breakdown_usd: {
    compute: 60,
    memory: 40,
    storage: 23.45,
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
      charge_usd: 60,
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
      charge_usd: 40,
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
      charge_usd: 0,
    },
  ],
  billing_period: {
    start: "2026-06-01T00:00:00.000Z",
    end: "2026-07-01T00:00:00.000Z",
  },
  pricing_tier: {
    plan_key: "payg",
    plan_name: "Pay-as-you-go",
    currency: "USD",
  },
  calculated_at: "2026-06-30T12:30:00.000Z",
}

vi.mock("@/hooks/use-customer-billing", () => ({
  useCustomerBillingPeriods: (...args: unknown[]) =>
    useCustomerBillingPeriods(...args),
}))

vi.mock("@/lib/api/billing-stripe", () => ({
  createStripeCheckoutSession: (...args: unknown[]) =>
    createStripeCheckoutSession(...args),
  createStripeCustomerPortalSession: (...args: unknown[]) =>
    createStripeCustomerPortalSession(...args),
}))

vi.mock("@superserve/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")
  return {
    ...actual,
    useToast: () => ({ addToast }),
  }
})

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <CustomerBillingSection
        teamId="team-1"
        teamRegion="use"
        teamName="Pilot Team"
        summary={baseSummary}
      />
    </QueryClientProvider>,
  )
}

describe("CustomerBillingSection", () => {
  beforeEach(() => {
    addToast.mockReset()
    createStripeCheckoutSession.mockReset()
    createStripeCustomerPortalSession.mockReset()
    useCustomerBillingPeriods.mockReset()
    window.history.replaceState({}, "", "/plan-usage")
    useCustomerBillingPeriods.mockReturnValue({
      data: {
        periods: [
          {
            period_id: "older",
            period_start: "2026-05-01T00:00:00.000Z",
            period_end: "2026-06-01T00:00:00.000Z",
            status: "exported",
            stripe_subscription_status: "trialing",
          },
          {
            period_id: "newer",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
            status: "active",
            stripe_subscription_id: "sub_test",
            stripe_customer_id: "cus_test",
            stripe_subscription_status: "active",
            stripe_invoice_status: "open",
          },
        ],
      },
      isPending: false,
      isFetching: false,
      error: null,
    })
  })

  it("uses the latest billing period even when the API returns unsorted rows", () => {
    renderSection()

    expect(screen.getByText("Open Customer Portal")).toBeInTheDocument()
    expect(screen.getAllByText("Jun 1, 2026 - Jul 1, 2026")).toHaveLength(2)
    expect(screen.getByText("Billing is live")).toBeInTheDocument()
    expect(screen.queryByText("Tracking only")).not.toBeInTheDocument()
    expect(screen.getByText("CPU")).toBeInTheDocument()
    expect(screen.getByText("Memory")).toBeInTheDocument()
    expect(screen.getByText("Storage")).toBeInTheDocument()
    expect(screen.getByText("Tracked only")).toBeInTheDocument()
    expect(screen.getAllByText("Billed")).toHaveLength(2)
    expect(screen.getByText("0.03 vCPU-hours")).toBeInTheDocument()
    expect(screen.getByText("0.56 GiB-hours")).toBeInTheDocument()
    expect(screen.getByText("1.11 GiB-hours")).toBeInTheDocument()
  })

  it("disables the CTA while billing periods are still loading", () => {
    useCustomerBillingPeriods.mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: true,
      error: null,
    })

    renderSection()

    expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled()
  })

  it("shows shadow mode messaging and blocks billing actions", () => {
    const shadowSummary = {
      ...baseSummary,
      billing_mode: "shadow" as const,
      checkout_available: false,
      portal_available: false,
      payment_setup_required: true,
      permissions: {
        can_view: true,
        can_manage: true,
      },
      resources: [
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
          charge_usd: 0,
        },
      ],
    }
    useCustomerBillingPeriods.mockReturnValue({
      data: {
        periods: [
          {
            period_id: "shadow",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
            status: "exported",
            stripe_subscription_status: "trialing",
          },
        ],
      },
      isPending: false,
      isFetching: false,
      error: null,
    })
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <CustomerBillingSection
          teamId="team-1"
          teamRegion="use"
          teamName="Pilot Team"
          summary={shadowSummary}
        />
      </QueryClientProvider>,
    )

    expect(
      screen.getByText("Usage is being tracked but you are not being charged"),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /tracking only/i }),
    ).toBeDisabled()
    expect(screen.getByText("Tracked only")).toBeInTheDocument()
  })

  it("shows a refresh notice when returning from Stripe", () => {
    window.history.replaceState({}, "", "/plan-usage?billing=success")

    renderSection()

    expect(screen.getByText("Returned from Stripe")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Billing status is refreshing against the latest server state.",
      ),
    ).toBeInTheDocument()
  })
})
