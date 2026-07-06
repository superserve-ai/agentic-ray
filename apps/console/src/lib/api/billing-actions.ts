"use server"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  listTeamMembershipsForUser,
  type TeamMembership,
} from "@/lib/api/team-directory"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

const MAX_USAGE_RANGE_MS = 90 * 24 * 60 * 60 * 1000
const USAGE_DASHBOARD_FLAG = "tenant_usage_dashboard"
const BILLING_METRICS_WRITE_FLAG = "billing_metrics_write"
const BILLING_EXPORT_FLAG = "billing_export_enabled"
const DEFAULT_PRICING_PLAN_KEY = "payg"
const REQUIRED_PRICING_RATE_KEYS = [
  "vcpu:second",
  "memory_gib:second",
  "storage_gib:second",
] as const

export interface BillingUsageHourly {
  hour_start: string
  hour_end: string
  vcpu_seconds: number
  memory_mib_seconds: number
  storage_mib_seconds: number
  updated_at: string
}

export type BillingUsageMode = "disabled" | "shadow" | "active"

export interface BillingPricing {
  cpu_vcpu_hour_usd: number
  memory_gib_hour_usd: number
  storage_gib_hour_usd: number
  source: "static_pricing_page" | "api"
}

export interface BillingUsageResponse {
  enabled: boolean
  billing_mode: BillingUsageMode
  pricing?: BillingPricing
  period_start: string
  period_end: string
  rows: BillingUsageHourly[]
}

export interface BillingSettingsResponse {
  enabled: boolean
  billing_mode: BillingUsageMode
  pricing?: BillingPricing
}

async function getTeam(userId: string): Promise<TeamMembership | null> {
  const memberships = await listTeamMembershipsForUser(userId)
  if (!memberships.length) return null

  const uniqueTeams = new Map(memberships.map((m) => [m.teamId, m]))
  if (uniqueTeams.size !== 1) {
    throw new Error("Select a team before viewing billing usage")
  }
  return [...uniqueTeams.values()][0]
}

function normalizePeriod(periodStart: string, periodEnd: string) {
  const start = new Date(periodStart)
  const requestedEnd = new Date(periodEnd)
  const now = new Date()
  const end = requestedEnd > now ? now : requestedEnd

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid billing usage period")
  }
  if (end <= start) {
    throw new Error("Billing usage period end must be after period start")
  }
  if (end.getTime() - start.getTime() > MAX_USAGE_RANGE_MS) {
    throw new Error("Billing usage period cannot exceed 90 days")
  }

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  }
}

async function getFeatureEnabled(
  admin: SupabaseClient,
  teamId: string,
  flagKey: string,
): Promise<boolean> {
  const { data: enabled, error } = await admin.rpc("feature_enabled", {
    flag_key: flagKey,
    flag_team_id: teamId,
  })
  if (error) throw new Error(error.message)
  return Boolean(enabled)
}

function numericToNumber(value: unknown, field: string): number {
  if (value === null || value === undefined || value === "") {
    throw new Error(`Missing billing usage metric: ${field}`)
  }

  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(numberValue)) {
    throw new Error(`Invalid billing usage metric: ${field}`)
  }

  return numberValue
}

function compareNullableStringsDesc(left: unknown, right: unknown): number {
  const leftString = typeof left === "string" ? left : ""
  const rightString = typeof right === "string" ? right : ""
  return rightString.localeCompare(leftString)
}

async function getTeamPricingPlanKey(
  admin: SupabaseClient,
  teamId: string,
): Promise<string> {
  const now = new Date().toISOString()
  const { data: assignments, error: assignmentError } = await admin
    .from("team_pricing_plan")
    .select("plan_key, effective_from, effective_to")
    .eq("team_id", teamId)
    .lte("effective_from", now)
    .order("effective_from", { ascending: false })
    .limit(20)

  if (assignmentError) throw new Error(assignmentError.message)
  const currentAssignments = (assignments ?? []).filter((row) => {
    const effectiveTo = row.effective_to as string | null
    return !effectiveTo || effectiveTo > now
  })
  if (!currentAssignments.length) return DEFAULT_PRICING_PLAN_KEY

  const planKeys = [
    ...new Set(currentAssignments.map((row) => row.plan_key as string)),
  ]
  const { data: activePlans, error: planError } = await admin
    .from("pricing_plan")
    .select("key")
    .in("key", planKeys)
    .eq("active", true)

  if (planError) throw new Error(planError.message)

  const activePlanKeys = new Set((activePlans ?? []).map((row) => row.key))
  return (
    (currentAssignments.find((row) => activePlanKeys.has(row.plan_key))
      ?.plan_key as string | undefined) ?? DEFAULT_PRICING_PLAN_KEY
  )
}

async function getBillingPricingForPlan(
  admin: SupabaseClient,
  planKey: string,
): Promise<BillingPricing> {
  const now = new Date().toISOString()
  const { data: rates, error } = await admin
    .from("pricing_rate")
    .select(
      "resource, unit, price_usd, effective_from, effective_to, created_at, id",
    )
    .eq("plan_key", planKey)
    .lte("effective_from", now)

  if (error) throw new Error(error.message)
  const currentRates = (rates ?? []).filter((row) => {
    const effectiveTo = row.effective_to as string | null
    return !effectiveTo || effectiveTo > now
  })
  if (!currentRates.length) {
    throw new Error(`Pricing plan ${planKey} has no active rates`)
  }

  const latestRates = new Map<string, (typeof currentRates)[number]>()
  for (const rate of currentRates) {
    const resource = rate.resource as string
    const unit = rate.unit as string
    const key = `${resource}:${unit}`
    if (!REQUIRED_PRICING_RATE_KEYS.includes(key as never)) {
      throw new Error(`Pricing plan ${planKey} has unsupported rate ${key}`)
    }

    const existing = latestRates.get(key)
    if (
      !existing ||
      compareNullableStringsDesc(rate.effective_from, existing.effective_from) <
        0 ||
      (rate.effective_from === existing.effective_from &&
        compareNullableStringsDesc(rate.created_at, existing.created_at) < 0) ||
      (rate.effective_from === existing.effective_from &&
        rate.created_at === existing.created_at &&
        compareNullableStringsDesc(rate.id, existing.id) < 0)
    ) {
      latestRates.set(key, rate)
    }
  }

  for (const key of REQUIRED_PRICING_RATE_KEYS) {
    if (!latestRates.has(key)) {
      throw new Error(`Pricing plan ${planKey} is missing active rate ${key}`)
    }
  }

  return {
    cpu_vcpu_hour_usd:
      numericToNumber(latestRates.get("vcpu:second")?.price_usd, "vcpu price") *
      3600,
    memory_gib_hour_usd:
      numericToNumber(
        latestRates.get("memory_gib:second")?.price_usd,
        "memory price",
      ) * 3600,
    storage_gib_hour_usd:
      numericToNumber(
        latestRates.get("storage_gib:second")?.price_usd,
        "storage price",
      ) * 3600,
    source: "api",
  }
}

async function getTeamBillingPricing(
  admin: SupabaseClient,
  teamId: string,
): Promise<BillingPricing> {
  const planKey = await getTeamPricingPlanKey(admin, teamId)
  return getBillingPricingForPlan(admin, planKey)
}

export async function getBillingUsageAction(
  periodStart: string,
  periodEnd: string,
): Promise<BillingUsageResponse> {
  const period = normalizePeriod(periodStart, periodEnd)

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const team = await getTeam(user.id)
  if (!team) {
    return {
      enabled: false,
      billing_mode: "disabled",
      period_start: period.periodStart,
      period_end: period.periodEnd,
      rows: [],
    }
  }

  // All billing data lives in the team's home cell.
  const admin = cellFor(team.region).createAdminClient()
  const teamId = team.teamId

  const dashboardEnabled = await getFeatureEnabled(
    admin,
    teamId,
    USAGE_DASHBOARD_FLAG,
  )
  if (!dashboardEnabled) {
    return {
      enabled: false,
      billing_mode: "disabled",
      period_start: period.periodStart,
      period_end: period.periodEnd,
      rows: [],
    }
  }

  const [metricsWriteEnabled, billingExportEnabled] = await Promise.all([
    getFeatureEnabled(admin, teamId, BILLING_METRICS_WRITE_FLAG),
    getFeatureEnabled(admin, teamId, BILLING_EXPORT_FLAG),
  ])
  if (!metricsWriteEnabled) {
    return {
      enabled: false,
      billing_mode: "disabled",
      period_start: period.periodStart,
      period_end: period.periodEnd,
      rows: [],
    }
  }

  const billingMode: BillingUsageMode = billingExportEnabled
    ? "active"
    : "shadow"
  const pricing = await getTeamBillingPricing(admin, teamId)

  const { data, error } = await admin
    .from("team_billing_usage_hourly")
    .select(
      "hour_start, hour_end, vcpu_seconds, memory_mib_seconds, storage_mib_seconds, updated_at",
    )
    .eq("team_id", teamId)
    .gte("hour_start", period.periodStart)
    .lt("hour_start", period.periodEnd)
    .order("hour_start", { ascending: true })

  if (error) throw new Error(error.message)

  return {
    enabled: true,
    billing_mode: billingMode,
    pricing,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    rows: (data ?? []).map((row) => ({
      hour_start: row.hour_start as string,
      hour_end: row.hour_end as string,
      vcpu_seconds: numericToNumber(row.vcpu_seconds, "vcpu_seconds"),
      memory_mib_seconds: numericToNumber(
        row.memory_mib_seconds,
        "memory_mib_seconds",
      ),
      storage_mib_seconds: numericToNumber(
        row.storage_mib_seconds,
        "storage_mib_seconds",
      ),
      updated_at: row.updated_at as string,
    })),
  }
}

export async function getBillingSettingsAction(): Promise<BillingSettingsResponse> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const team = await getTeam(user.id)
  if (!team) {
    return {
      enabled: false,
      billing_mode: "disabled",
    }
  }

  const admin = cellFor(team.region).createAdminClient()
  const billingExportEnabled = await getFeatureEnabled(
    admin,
    team.teamId,
    BILLING_EXPORT_FLAG,
  )

  if (!billingExportEnabled) {
    return {
      enabled: false,
      billing_mode: "disabled",
    }
  }

  return {
    enabled: true,
    billing_mode: "active",
    pricing: await getTeamBillingPricing(admin, team.teamId),
  }
}
