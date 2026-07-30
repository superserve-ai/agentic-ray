import type { SortDirection } from "./types"

export const PLATFORM_BILLING_SORT_COLUMNS = [
  "team_name",
  "current_charges_usd",
  "expected_invoice_amount_usd",
  // `credits_applied_usd` is intentionally omitted until the platform billing
  // API exposes a server-side sort key for it.
  "credits_remaining_usd",
] as const

export type PlatformBillingSortColumn =
  (typeof PLATFORM_BILLING_SORT_COLUMNS)[number]

export interface PlatformBillingListParams {
  page: number
  pageSize: number
  sort: PlatformBillingSortColumn
  order: SortDirection
  search?: string
}

export type PlatformBillingRowError =
  | string
  | {
      code?: string
      message: string
      details?: string[]
    }

export interface PlatformBillingRowSummary {
  current_charges_usd: number
  credits_applied_usd: number
  credits_remaining_usd: number
  expected_invoice_amount_usd: number
  cost_breakdown_usd: {
    compute: number
    memory: number
    storage: number
  }
  billing_period: {
    start: string
    end: string
  }
  pricing_tier: {
    plan_key: string
    plan_name: string
    currency: string
  }
  calculated_at: string
}

export interface PlatformBillingRow {
  team_id: string
  team_name: string
  summary: PlatformBillingRowSummary | null
  error?: PlatformBillingRowError
}

export interface PlatformBillingTotals {
  current_charges_usd: number
  credits_applied_usd: number
  credits_remaining_usd: number
  expected_invoice_amount_usd: number
  teams: number
  succeeded: number
  failed: number
}

export interface PlatformBillingPagination {
  limit: number
  offset: number
  total: number
}

export interface PlatformBillingSummary {
  totals: PlatformBillingTotals
  pagination: PlatformBillingPagination
  rows: PlatformBillingRow[]
}

export function platformBillingListQuery(
  params: PlatformBillingListParams,
): string {
  const q = new URLSearchParams()
  q.set("limit", String(params.pageSize))
  q.set("offset", String((params.page - 1) * params.pageSize))
  q.set("sort", params.sort)
  q.set("order", params.order)
  if (params.search) q.set("search", params.search)
  return q.toString()
}
