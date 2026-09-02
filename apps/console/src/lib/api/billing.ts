import { apiClient } from "./client"

export interface BillingSummaryCostBreakdown {
  compute: number
  memory: number
  storage: number
}

export interface BillingSummaryPermissions {
  can_view: boolean
  can_manage: boolean
}

export interface BillingSummaryResource {
  resource_key: string
  resource: string
  display_name: string
  sort_order: number
  unit: string
  display_unit: string
  usage: number
  tracked: boolean
  billable: boolean
  charge_usd: number
}

export interface BillingSummaryPeriod {
  start: string
  end: string
}

export interface BillingSummaryPricingTier {
  plan_key: string
  plan_name: string
  currency: string
}

export interface BillingSummaryResponse {
  billing_mode: "shadow" | "live"
  checkout_available: boolean
  portal_available: boolean
  payment_setup_required: boolean
  permissions: BillingSummaryPermissions
  current_charges_usd: number
  credits_applied_usd: number
  credits_remaining_usd: number
  expected_invoice_amount_usd: number
  cost_breakdown_usd: BillingSummaryCostBreakdown
  resources: BillingSummaryResource[]
  resources_by_key?: Record<string, BillingSummaryResource>
  billing_period: BillingSummaryPeriod
  pricing_tier: BillingSummaryPricingTier
  calculated_at: string
}

export async function getBillingSummary(): Promise<BillingSummaryResponse> {
  return apiClient<BillingSummaryResponse>("/billing/summary", {
    cache: "no-store",
  })
}
