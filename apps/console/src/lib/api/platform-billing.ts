import { apiClient } from "./client"
import type { SortDirection } from "./types"

export const PLATFORM_BILLING_SORT_COLUMNS = [
  "team_name",
  "current_charges_usd",
  "credits_applied_usd",
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
  q?: string
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
  error?: PlatformBillingRowError
}

export interface PlatformBillingSummary {
  period_start: string | null
  period_end: string | null
  current_charges_usd: number
  credits_applied_usd: number
  credits_remaining_usd: number
  expected_invoice_amount_usd: number
  total: number
  rows: PlatformBillingRow[]
}

function platformBillingListQuery(params: PlatformBillingListParams): string {
  const q = new URLSearchParams()
  q.set("limit", String(params.pageSize))
  q.set("offset", String((params.page - 1) * params.pageSize))
  q.set("sort", params.sort)
  q.set("order", params.order)
  if (params.q) q.set("q", params.q)
  return q.toString()
}

export async function listPlatformBillingPaged(
  params: PlatformBillingListParams,
): Promise<PlatformBillingSummary> {
  return apiClient<PlatformBillingSummary>(
    `/platform/billing?${platformBillingListQuery(params)}`,
  )
}
