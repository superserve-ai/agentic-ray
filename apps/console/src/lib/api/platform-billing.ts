import type { SortDirection } from "./types"

export const PLATFORM_BILLING_SORT_COLUMNS = [
  "team_name",
  "current_charges_usd",
  "expected_invoice_amount_usd",
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

export interface PlatformBillingRow {
  team_id: string
  team_name: string
  summary: {
    region: string
    current_charges_usd: number
    credits_applied_usd: number
    credits_remaining_usd: number
    expected_invoice_amount_usd: number
    compute_usd: number
    memory_usd: number
    storage_usd: number
    billing_period_start: string
    billing_period_end: string
    billing_mode: "active" | "unavailable"
  }
  error?: PlatformBillingRowError
}

export interface PlatformBillingTotals {
  current_charges_usd: number
  credits_applied_usd: number
  credits_remaining_usd: number
  expected_invoice_amount_usd: number
}

export interface PlatformBillingPagination {
  page: number
  page_size: number
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
