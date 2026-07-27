"use server"

import { ensureImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import {
  PLATFORM_BILLING_READ_PERMISSION,
  canReadPlatformBilling,
} from "@/lib/admin/permissions"
import { isStaff } from "@/lib/admin/staff"
import type { BillingSummaryResponse } from "@/lib/api/billing"
import { listAllTeams } from "@/lib/api/team-directory"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

const FETCH_CONCURRENCY = 8

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
  error?: string
}

export interface PlatformBillingSummary {
  period_start: string | null
  period_end: string | null
  current_charges_usd: number
  credits_applied_usd: number
  credits_remaining_usd: number
  expected_invoice_amount_usd: number
  rows: PlatformBillingRow[]
}

async function requirePlatformBillingRead() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !isStaff(user) || !canReadPlatformBilling(user)) {
    throw new Error("Forbidden: platform billing read access required")
  }

  return user
}

function unavailableRow(
  team: Awaited<ReturnType<typeof listAllTeams>>[number],
  error: unknown,
): PlatformBillingRow {
  return {
    team_id: team.id,
    team_name: team.name,
    region: team.region,
    current_charges_usd: 0,
    credits_applied_usd: 0,
    credits_remaining_usd: 0,
    expected_invoice_amount_usd: 0,
    compute_usd: 0,
    memory_usd: 0,
    storage_usd: 0,
    billing_period_start: "",
    billing_period_end: "",
    billing_mode: "unavailable",
    error:
      error instanceof Error ? error.message : "Billing summary unavailable",
  }
}

async function fetchTeamBilling(
  userId: string,
  team: Awaited<ReturnType<typeof listAllTeams>>[number],
): Promise<PlatformBillingRow> {
  try {
    const apiKey = await ensureImpersonationKeyRow(
      userId,
      team.id,
      team.region,
      [PLATFORM_BILLING_READ_PERMISSION],
    )
    const url = new URL(`${cellFor(team.region).apiBaseUrl}/billing/summary`)
    url.searchParams.set("team_id", team.id)

    const response = await fetch(url, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
    })
    if (!response.ok) {
      throw new Error(`Billing API returned ${response.status}`)
    }

    const summary = (await response.json()) as BillingSummaryResponse
    return {
      team_id: team.id,
      team_name: team.name,
      region: team.region,
      current_charges_usd: summary.current_charges_usd,
      credits_applied_usd: summary.credits_applied_usd,
      credits_remaining_usd: summary.credits_remaining_usd,
      expected_invoice_amount_usd: summary.expected_invoice_amount_usd,
      compute_usd: summary.cost_breakdown_usd.compute,
      memory_usd: summary.cost_breakdown_usd.memory,
      storage_usd: summary.cost_breakdown_usd.storage,
      billing_period_start: summary.billing_period.start,
      billing_period_end: summary.billing_period.end,
      billing_mode: "active",
    }
  } catch (error) {
    return unavailableRow(team, error)
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  )
  return results
}

export async function getPlatformBillingAction(): Promise<PlatformBillingSummary> {
  const user = await requirePlatformBillingRead()
  const teams = await listAllTeams()
  const rows = await mapWithConcurrency(teams, FETCH_CONCURRENCY, (team) =>
    fetchTeamBilling(user.id, team),
  )
  rows.sort((a, b) => b.current_charges_usd - a.current_charges_usd)

  const availableRows = rows.filter((row) => row.billing_mode === "active")
  const firstAvailable = availableRows[0]

  return {
    period_start: firstAvailable?.billing_period_start || null,
    period_end: firstAvailable?.billing_period_end || null,
    current_charges_usd: availableRows.reduce(
      (sum, row) => sum + row.current_charges_usd,
      0,
    ),
    credits_applied_usd: availableRows.reduce(
      (sum, row) => sum + row.credits_applied_usd,
      0,
    ),
    credits_remaining_usd: availableRows.reduce(
      (sum, row) => sum + row.credits_remaining_usd,
      0,
    ),
    expected_invoice_amount_usd: availableRows.reduce(
      (sum, row) => sum + row.expected_invoice_amount_usd,
      0,
    ),
    rows,
  }
}
