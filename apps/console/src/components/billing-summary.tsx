"use client"

import { ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { Skeleton, cn } from "@superserve/ui"
import type { ReactNode } from "react"

import { ErrorState } from "@/components/error-state"
import type { BillingSummaryResponse } from "@/lib/api/billing"
import { ApiError } from "@/lib/api/client"

const BREAKDOWN_ROWS = [
  {
    key: "compute",
    label: "Compute (vCPU)",
    barClassName: "bg-primary",
  },
  {
    key: "memory",
    label: "Memory (GiB)",
    barClassName: "bg-success",
  },
  {
    key: "storage",
    label: "Storage (GiB)",
    barClassName: "bg-warning",
  },
] as const

const MIN_PROJECTION_ELAPSED_MS = 4 * 60 * 60 * 1000
export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export function currencyCode(summary: BillingSummaryResponse): string {
  return summary.pricing_tier.currency || "USD"
}

export function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export function formatPeriodDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function formatCount(
  value: number,
  unit: "day" | "hour" | "minute",
): string {
  const rounded = Math.max(Math.round(value), 0)
  return `${rounded} ${unit}${rounded === 1 ? "" : "s"}`
}

export interface BillingCycleProgress {
  percentage: number
  elapsedMs: number
  remainingMs: number
  totalMs: number
}

export function getBillingCycleProgress(
  start: string,
  end: string,
  nowMs: number = Date.now(),
): BillingCycleProgress {
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  const totalMs = Math.max(endMs - startMs, 0)
  const clampedNow = Math.min(Math.max(nowMs, startMs), endMs)
  const elapsedMs = Math.max(clampedNow - startMs, 0)
  const remainingMs = Math.max(endMs - clampedNow, 0)
  const percentage = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0

  return { percentage, elapsedMs, remainingMs, totalMs }
}

export function formatDurationRemaining(ms: number): string {
  const safeMs = Math.max(ms, 0)
  if (safeMs >= DAY_MS) return formatCount(safeMs / DAY_MS, "day")
  if (safeMs >= HOUR_MS) return formatCount(safeMs / HOUR_MS, "hour")
  if (safeMs >= MINUTE_MS) return formatCount(safeMs / MINUTE_MS, "minute")
  return "less than a minute"
}

export interface ProjectedStatementRow {
  label: string
  value: number
  emphasize?: boolean
  negative?: boolean
}

export interface ProjectedPeriodEndEstimate {
  available: boolean
  projectedCharges: number | null
  estimatedCredits: number | null
  estimatedInvoice: number | null
}

export interface StatementBreakdownRow {
  label: string
  value: number
  negative?: boolean
}

export function getProjectedPeriodEndEstimate(
  summary: BillingSummaryResponse,
  nowMs: number = Date.now(),
): ProjectedPeriodEndEstimate {
  const progress = getBillingCycleProgress(
    summary.billing_period.start,
    summary.billing_period.end,
    nowMs,
  )

  if (progress.totalMs <= 0 || progress.elapsedMs < MIN_PROJECTION_ELAPSED_MS) {
    return {
      available: false,
      projectedCharges: null,
      estimatedCredits: null,
      estimatedInvoice: null,
    }
  }

  const projectedCharges =
    (summary.current_charges_usd * progress.totalMs) / progress.elapsedMs
  const estimatedCredits = Math.min(
    Math.max(summary.credits_remaining_usd, 0),
    projectedCharges,
  )

  return {
    available: true,
    projectedCharges,
    estimatedCredits,
    estimatedInvoice: Math.max(projectedCharges - estimatedCredits, 0),
  }
}

export function getProjectedStatementRows(
  summary: BillingSummaryResponse,
  nowMs: number = Date.now(),
): ProjectedStatementRow[] | null {
  const estimate = getProjectedPeriodEndEstimate(summary, nowMs)
  if (!estimate.available) return null

  return [
    { label: "Projected Charges", value: estimate.projectedCharges ?? 0 },
    {
      label: "Estimated Credits",
      value: estimate.estimatedCredits ?? 0,
      negative: true,
    },
    {
      label: "Estimated Invoice",
      value: estimate.estimatedInvoice ?? 0,
      emphasize: true,
    },
  ]
}

export function getCurrentBreakdownRows(
  summary: BillingSummaryResponse,
): StatementBreakdownRow[] {
  return BREAKDOWN_ROWS.map((row) => ({
    label: row.label,
    value: summary.cost_breakdown_usd[row.key],
  }))
}

export function getProjectedBreakdownRows(
  summary: BillingSummaryResponse,
  projectedCharges: number,
): StatementBreakdownRow[] {
  const currentTotal = Math.max(summary.current_charges_usd, 0)
  if (currentTotal <= 0 || projectedCharges <= 0) {
    return BREAKDOWN_ROWS.map((row) => ({
      label: row.label,
      value: 0,
    }))
  }

  const scale = projectedCharges / currentTotal
  return BREAKDOWN_ROWS.map((row) => ({
    label: row.label,
    value: summary.cost_breakdown_usd[row.key] * scale,
  }))
}

export function billingErrorMessage(error: unknown): {
  title: string
  message: string
  suggestion?: string
} {
  if (error instanceof ApiError && error.status === 403) {
    return {
      title: "Billing Access Required",
      message: "Your account does not have billing read access for this team.",
      suggestion: "Ask a team owner to grant a billing role.",
    }
  }

  if (error instanceof ApiError && error.status === 401) {
    return {
      title: "Sign In Required",
      message: "Your session is missing or expired.",
      suggestion: "Sign in again to view billing.",
    }
  }

  return {
    title: "Billing Summary Unavailable",
    message:
      error instanceof Error
        ? error.message
        : "The billing summary could not be loaded.",
  }
}

export function BillingSummary({
  summary,
}: {
  summary: BillingSummaryResponse
}) {
  const currency = currencyCode(summary)
  const periodStart = formatPeriodDate(summary.billing_period.start)
  const periodEnd = formatPeriodDate(summary.billing_period.end)
  const remainingDays = Math.max(
    Math.ceil(
      getBillingCycleProgress(
        summary.billing_period.start,
        summary.billing_period.end,
      ).remainingMs / DAY_MS,
    ),
    0,
  )
  const projectedRows = getProjectedStatementRows(summary)
  const projectedCharges = projectedRows?.[0]?.value ?? null
  const currentBreakdownRows = getCurrentBreakdownRows(summary)
  const projectedBreakdownRows =
    projectedCharges == null
      ? null
      : getProjectedBreakdownRows(summary, projectedCharges)

  return (
    <section className="space-y-2" data-testid="billing-statement">
      <div className="mx-auto w-full max-w-4xl space-y-2">
        <div className="space-y-2 text-center">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Billing Summary
          </h2>
          <p className="text-sm text-muted">
            {periodStart} - {periodEnd} · {remainingDays} days remaining
          </p>
        </div>
        <div className="border-t border-border/70" />
        <div
          className="border border-border/70 bg-gradient-to-br from-surface/80 via-surface/55 to-background p-4 shadow-sm shadow-black/5 sm:p-5"
          data-testid="billing-statement-grid"
        >
          <div className="grid gap-8 lg:grid-cols-2">
            <StatementColumn
              title="Current Balance"
              sectionLabel="Charges"
              total={summary.expected_invoice_amount_usd}
              currency={currency}
              totalTone="current"
            >
              <div className="space-y-1.5">
                {currentBreakdownRows.map((row) => (
                  <StatementLine
                    key={row.label}
                    label={row.label}
                    value={row.value}
                    currency={currency}
                  />
                ))}
              </div>
              <StatementLine
                label="Credits Applied"
                value={summary.credits_applied_usd}
                currency={currency}
                negative
              />
            </StatementColumn>

            <StatementColumn
              title="Estimated Invoice"
              sectionLabel="Estimated Invoice"
              total={
                projectedRows?.find((row) => row.label === "Estimated Invoice")
                  ?.value ?? null
              }
              currency={currency}
              totalTone="projected"
              available={projectedRows != null}
            >
              {projectedRows ? (
                <>
                  <div className="space-y-1.5">
                    {projectedBreakdownRows?.map((row) => (
                      <StatementLine
                        key={row.label}
                        label={row.label}
                        value={row.value}
                        currency={currency}
                      />
                    ))}
                  </div>
                  <StatementLine
                    label="Estimated Credits Applied"
                    value={
                      projectedRows.find(
                        (row) => row.label === "Estimated Credits",
                      )?.value ?? 0
                    }
                    currency={currency}
                    negative
                  />
                </>
              ) : (
                <p className="text-sm text-muted">Not enough usage data</p>
              )}
            </StatementColumn>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 font-mono text-[11px] text-muted uppercase">
            <ClockCounterClockwiseIcon className="size-4" />
            <span>
              Credits remaining:{" "}
              {formatCurrency(summary.credits_remaining_usd, currency)}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function StatementColumn({
  title,
  sectionLabel,
  total,
  currency,
  totalTone,
  available = true,
  children,
}: {
  title: string
  sectionLabel: string
  total: number | null
  currency: string
  totalTone: "current" | "projected"
  available?: boolean
  children: ReactNode
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <div
          className={cn(
            "font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl",
            totalTone === "projected" && "text-foreground",
          )}
        >
          {total == null
            ? "Not enough usage data"
            : formatCurrency(total, currency)}
        </div>
      </div>
      <div className="space-y-1">
        <p className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">
          {sectionLabel}
        </p>
      </div>
      <div className="space-y-3">{available ? children : null}</div>
    </div>
  )
}

function StatementLine({
  label,
  value,
  currency,
  negative = false,
}: {
  label: string
  value: number
  currency: string
  negative?: boolean
}) {
  const prefix = negative && value !== 0 ? "-" : ""
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 text-sm">
      <span className="text-foreground">{label}</span>
      <span className="font-mono text-foreground">
        {prefix}
        {formatCurrency(Math.abs(value), currency)}
      </span>
    </div>
  )
}

export function BillingError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const details = billingErrorMessage(error)
  return (
    <ErrorState
      title={details.title}
      message={details.message}
      suggestion={details.suggestion}
      onRetry={onRetry}
    />
  )
}

export function BillingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="space-y-3 border border-border bg-surface/30 p-3"
          >
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2 w-32" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((__, rowIndex) => (
                <div
                  key={rowIndex}
                  className="flex items-center justify-between gap-3"
                >
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-3"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
