import { apiClient } from "./client"

export interface BillingSummaryCostBreakdown {
  compute: number
  memory: number
  storage: number
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
  current_charges_usd: number
  credits_applied_usd: number
  credits_remaining_usd: number
  expected_invoice_amount_usd: number
  cost_breakdown_usd: BillingSummaryCostBreakdown
  billing_period: BillingSummaryPeriod
  pricing_tier: BillingSummaryPricingTier
  calculated_at: string
}

export async function getBillingSummary(): Promise<BillingSummaryResponse> {
  return apiClient<BillingSummaryResponse>("/billing/summary", {
    cache: "no-store",
  })
}
