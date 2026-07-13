import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

import PlanUsagePage from "./page"

const useBillingSummary = vi.fn()
const useBillingUsage = vi.fn()
const useSandboxesPage = vi.fn()
const useUser = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => "/plan-usage",
}))

vi.mock("@/hooks/use-billing-usage", () => ({
  useBillingUsage: (...args: unknown[]) => useBillingUsage(...args),
}))

vi.mock("@/hooks/use-sandboxes", () => ({
  useSandboxesPage: (...args: unknown[]) => useSandboxesPage(...args),
}))

vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: (...args: unknown[]) => useBillingSummary(...args),
}))

vi.mock("@/hooks/use-user", () => ({
  useUser: () => useUser(),
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <PlanUsagePage />
    </QueryClientProvider>,
  )
}

describe("PlanUsagePage", () => {
  beforeEach(() => {
    useUser.mockReturnValue({
      user: { id: "user-1" },
      loading: false,
    })
    useSandboxesPage.mockImplementation(({ status }: { status?: string }) => {
      const totals: Record<string, number> = {
        active: 5,
        resuming: 1,
        paused: 3,
        failed: 2,
      }

      return {
        data: {
          total: totals[status ?? ""] ?? 0,
          items:
            status === "active"
              ? [
                  {
                    id: "sandbox-1",
                    name: "alpha",
                    status: "active",
                    vcpu_count: 1,
                    memory_mib: 1024,
                    metadata: {},
                    created_at: "2026-06-30T12:00:00.000Z",
                  },
                ]
              : [],
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      }
    })
    useBillingSummary.mockReturnValue({
      data: {
        current_charges_usd: 123.45,
        credits_applied_usd: 23.45,
        credits_remaining_usd: 76.55,
        expected_invoice_amount_usd: 100,
        cost_breakdown_usd: {
          compute: 60,
          memory: 40,
          storage: 23.45,
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
        calculated_at: "2026-06-30T12:30:00.000Z",
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it("shows the preview state when billing dashboard access is disabled", () => {
    useBillingUsage.mockReturnValue({
      data: {
        enabled: false,
        billing_mode: "disabled",
        period_start: "2026-06-01T00:00:00.000Z",
        period_end: "2026-06-02T00:00:00.000Z",
        rows: [],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByText("Free During Preview")).toBeInTheDocument()
    expect(screen.queryByText("Pay-as-you-go • USD")).toBeInTheDocument()
    expect(useBillingUsage).toHaveBeenCalledWith(
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-07-01T00:00:00.000Z"),
      true,
    )
  })

  it("shows a not-charged indicator for shadow usage", () => {
    useBillingUsage.mockReturnValue({
      data: {
        enabled: true,
        billing_mode: "shadow",
        period_start: "2026-06-01T00:00:00.000Z",
        period_end: "2026-06-02T00:00:00.000Z",
        rows: [
          {
            hour_start: "2026-06-01T00:00:00.000Z",
            hour_end: "2026-06-01T01:00:00.000Z",
            vcpu_seconds: 120,
            memory_mib_seconds: 2048,
            storage_mib_seconds: 4096,
            updated_at: "2026-06-01T01:05:00.000Z",
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(
      screen.getByText("Your team is not being charged for this usage yet."),
    ).toBeInTheDocument()
    expect(screen.getByTestId("compute-section")).toBeInTheDocument()
    expect(screen.getByTestId("storage-section")).toBeInTheDocument()
    expect(
      screen.queryByTestId("sandbox-state-section"),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Billing Period")).toBeInTheDocument()
    expect(screen.getByText("Pay-as-you-go • USD")).toBeInTheDocument()
    expect(screen.getByText("Credits remaining: $76.55")).toBeInTheDocument()
    expect(screen.getByText("Running")).toBeInTheDocument()
    expect(screen.getByText("Paused")).toBeInTheDocument()
  })

  it("does not show the not-charged indicator for active usage", () => {
    useBillingUsage.mockReturnValue({
      data: {
        enabled: true,
        billing_mode: "active",
        period_start: "2026-06-01T00:00:00.000Z",
        period_end: "2026-06-02T00:00:00.000Z",
        rows: [
          {
            hour_start: "2026-06-01T00:00:00.000Z",
            hour_end: "2026-06-01T01:00:00.000Z",
            vcpu_seconds: 120,
            memory_mib_seconds: 2048,
            storage_mib_seconds: 4096,
            updated_at: "2026-06-01T01:05:00.000Z",
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(
      screen.queryByText(/not being charged for this usage yet/i),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Usage Details")).toBeInTheDocument()
    expect(screen.queryByText(/Last updated:/i)).not.toBeInTheDocument()
    expect(screen.getByText("Pay-as-you-go • USD")).toBeInTheDocument()
    expect(screen.getByTestId("usage-cards-grid")).toHaveClass("xl:grid-cols-3")
    const sandboxesCard = screen.getByTestId("sandboxes-card")
    const computeSection = screen.getByTestId("compute-section")
    const storageSection = screen.getByTestId("storage-section")
    expect(sandboxesCard).toBeInTheDocument()
    expect(computeSection).toBeInTheDocument()
    expect(storageSection).toBeInTheDocument()
    expect(
      screen.queryByTestId("sandbox-state-section"),
    ).not.toBeInTheDocument()
    expect(within(sandboxesCard).getByText("Running")).toBeInTheDocument()
    expect(within(sandboxesCard).getByText("Paused")).toBeInTheDocument()
    expect(within(computeSection).getByText("This period")).toBeInTheDocument()
    expect(screen.queryByText("CPU Usage")).not.toBeInTheDocument()
    expect(screen.queryByText("Memory Usage")).not.toBeInTheDocument()
    expect(screen.queryByText("Storage Context")).not.toBeInTheDocument()
    expect(within(storageSection).getByText("Storage")).toBeInTheDocument()
  })

  it("keeps usage visible when billing summary access is denied", () => {
    useBillingSummary.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError(403, "forbidden", "Forbidden"),
      refetch: vi.fn(),
    })
    useBillingUsage.mockReturnValue({
      data: {
        enabled: true,
        billing_mode: "active",
        period_start: "2026-06-01T00:00:00.000Z",
        period_end: "2026-06-02T00:00:00.000Z",
        rows: [
          {
            hour_start: "2026-06-01T00:00:00.000Z",
            hour_end: "2026-06-01T01:00:00.000Z",
            vcpu_seconds: 120,
            memory_mib_seconds: 2048,
            storage_mib_seconds: 4096,
            updated_at: "2026-06-01T01:05:00.000Z",
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByText("Billing Access Required")).toBeInTheDocument()
    expect(screen.getByText("Usage Details")).toBeInTheDocument()
    expect(screen.getByTestId("compute-section")).toBeInTheDocument()
    expect(screen.getByTestId("storage-section")).toBeInTheDocument()
    expect(screen.queryByText("CPU Usage")).not.toBeInTheDocument()
  })
})
