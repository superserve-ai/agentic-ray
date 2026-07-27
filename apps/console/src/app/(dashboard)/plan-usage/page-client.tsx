"use client"

import { ChartBarIcon, LightningIcon } from "@phosphor-icons/react"
import { Spinner } from "@superserve/ui"
import { usePathname, useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import {
  BillingError,
  BillingSkeleton,
  BillingSummary,
  billingErrorMessage,
} from "@/components/billing-summary"
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { TableSkeleton } from "@/components/table-skeleton"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { useBillingUsage } from "@/hooks/use-billing-usage"
import { useSandboxesPage } from "@/hooks/use-sandboxes"
import { useUser } from "@/hooks/use-user"
import type { BillingUsageHourly } from "@/lib/api/billing-actions"

import {
  buildUsageChartPoints,
  getUsageChartBucket,
  type UsageChartBucket,
  type UsageMetric,
} from "./usage-chart"

export {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  formatCount,
  formatDurationRemaining,
  getBillingCycleProgress,
  getProjectedPeriodEndEstimate,
  getProjectedStatementRows,
} from "@/components/billing-summary"

const EMPTY_ROWS: BillingUsageHourly[] = []

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function defaultUsageRange(): DateRange {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 7)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function toDateRange(period?: {
  start: string
  end: string
}): DateRange | null {
  if (!period) return null
  return {
    start: new Date(period.start),
    end: new Date(period.end),
  }
}

export function PlanUsagePageClient() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading: userLoading } = useUser()
  const summaryQuery = useBillingSummary(!userLoading && !!user)
  const summary = summaryQuery.data
  const billingPeriod = useMemo(
    () => toDateRange(summary?.billing_period),
    [summary?.billing_period],
  )
  const [fallbackRange] = useState<DateRange>(() => defaultUsageRange())
  const [dateRange, setDateRange] = useState<DateRange | null>(null)

  const selectedRange = dateRange ?? billingPeriod ?? fallbackRange
  const usageQuery = useBillingUsage(
    selectedRange.start,
    selectedRange.end,
    !userLoading && !!user,
  )
  const rows = usageQuery.data?.rows ?? EMPTY_ROWS
  const isBillingPreview = usageQuery.data?.billing_mode === "shadow"
  const chartPeriodStart =
    usageQuery.data?.period_start ?? selectedRange.start.toISOString()
  const chartPeriodEnd =
    usageQuery.data?.period_end ?? selectedRange.end.toISOString()
  const chartBucket = getUsageChartBucket(chartPeriodStart, chartPeriodEnd)

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        vcpuSeconds: acc.vcpuSeconds + row.vcpu_seconds,
        memoryGibSeconds: acc.memoryGibSeconds + row.memory_mib_seconds / 1024,
        storageGibSeconds:
          acc.storageGibSeconds + row.storage_mib_seconds / 1024,
      }),
      {
        vcpuSeconds: 0,
        memoryGibSeconds: 0,
        storageGibSeconds: 0,
      },
    )
  }, [rows])
  const usageHours = useMemo(
    () => ({
      vcpuHours: totals.vcpuSeconds / 3600,
      memoryGibHours: totals.memoryGibSeconds / 3600,
      storageGibHours: totals.storageGibSeconds / 3600,
    }),
    [totals],
  )

  const currentSandboxQuery = useSandboxesPage({
    page: 1,
    pageSize: 1,
    sort: "created_at",
    order: "desc",
    status: "active",
  })
  const resumingSandboxQuery = useSandboxesPage({
    page: 1,
    pageSize: 1,
    sort: "created_at",
    order: "desc",
    status: "resuming",
  })
  const pausedSandboxQuery = useSandboxesPage({
    page: 1,
    pageSize: 1,
    sort: "created_at",
    order: "desc",
    status: "paused",
  })

  const sandboxState = useMemo(() => {
    const running =
      (currentSandboxQuery.data?.total ?? 0) +
      (resumingSandboxQuery.data?.total ?? 0)

    return {
      running,
      paused: pausedSandboxQuery.data?.total ?? 0,
    }
  }, [
    currentSandboxQuery.data?.total,
    pausedSandboxQuery.data?.total,
    resumingSandboxQuery.data?.total,
  ])
  const sandboxStateLoading =
    currentSandboxQuery.isPending ||
    resumingSandboxQuery.isPending ||
    pausedSandboxQuery.isPending

  const usageErrorDetails = usageQuery.error
    ? billingErrorMessage(usageQuery.error)
    : null

  const handleRangeChange = (range: DateRange | null) => {
    setDateRange(range ?? billingPeriod)
  }

  const signInPath = pathname ? `/auth/signin?next=${pathname}` : "/auth/signin"

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Billing & Usage">
        {summary ? (
          <p className="text-[11px] font-medium text-muted sm:text-right sm:text-sm">
            {summary.pricing_tier.plan_name} •{" "}
            {summary.pricing_tier.currency || "USD"}
          </p>
        ) : null}
      </PageHeader>

      {userLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="border-foreground/20 border-t-foreground" />
        </div>
      ) : !user ? (
        <EmptyState
          icon={LightningIcon}
          title="Sign In Required"
          description="Your session is missing or expired. Sign in again to view billing and usage."
          actionLabel="Sign In"
          onAction={() => router.push(signInPath)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-5">
            {summaryQuery.isPending ? (
              <BillingSkeleton />
            ) : summaryQuery.error ? (
              <BillingError
                error={summaryQuery.error}
                onRetry={() => void summaryQuery.refetch()}
              />
            ) : summary ? (
              <BillingSummary summary={summary} />
            ) : null}

            <div className="border-t border-border/80 pt-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">
                    Usage Details
                  </h2>
                  <p className="text-sm text-muted">
                    Understand what is driving your current charges.
                  </p>
                </div>
                <DateRangeFilter
                  value={dateRange ?? billingPeriod ?? null}
                  billingPeriod={billingPeriod}
                  onChange={handleRangeChange}
                />
              </div>

              {usageQuery.isPending ? (
                <TableSkeleton columns={5} />
              ) : usageErrorDetails ? (
                <ErrorState
                  message={usageErrorDetails.message}
                  suggestion={usageErrorDetails.suggestion}
                  title={usageErrorDetails.title}
                  onRetry={() => void usageQuery.refetch()}
                />
              ) : usageQuery.data?.enabled === false ? (
                <EmptyState
                  icon={LightningIcon}
                  title="Free During Preview"
                  description="Superserve is free during the preview period. We'll notify you before any pricing changes."
                />
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={ChartBarIcon}
                  title="No Usage For This Period"
                  description="Usage will appear here after hourly billing rollups are generated."
                />
              ) : (
                <div
                  className="grid gap-4 xl:grid-cols-3"
                  data-testid="usage-cards-grid"
                >
                  {isBillingPreview && (
                    <div className="col-span-full border border-dashed border-border bg-brand/5 px-4 py-2.5 text-sm text-foreground">
                      Your team is not being charged for this usage yet.
                    </div>
                  )}

                  <section
                    className="space-y-4 border border-border/70 bg-surface/40 p-4 shadow-sm shadow-black/5"
                    data-testid="sandboxes-card"
                  >
                    <h3 className="text-base font-semibold text-foreground">
                      Sandboxes
                    </h3>
                    {sandboxStateLoading ? (
                      <p className="text-sm text-muted">
                        Loading sandbox states...
                      </p>
                    ) : (
                      <>
                        <div className="grid gap-1.5 text-sm text-foreground">
                          <InlineMetric
                            label="Running"
                            value={sandboxState.running}
                          />
                          <InlineMetric
                            label="Paused"
                            value={sandboxState.paused}
                          />
                        </div>
                      </>
                    )}
                  </section>

                  <section
                    className="scroll-mt-24 space-y-4 border border-border/70 bg-surface/40 p-4 shadow-sm shadow-black/5"
                    data-testid="compute-section"
                  >
                    <h3 className="text-base font-semibold text-foreground">
                      Compute
                    </h3>
                    <InlineTextBlock
                      label="This period"
                      value={`${formatNumber(usageHours.vcpuHours)} vCPU-hours / ${formatNumber(usageHours.memoryGibHours)} GiB-hours`}
                    />
                    <CombinedComputeTrendPanel
                      rows={rows}
                      periodStart={chartPeriodStart}
                      periodEnd={chartPeriodEnd}
                      bucket={chartBucket}
                    />
                  </section>

                  <section
                    className="scroll-mt-24 space-y-4 border border-border/70 bg-surface/40 p-4 shadow-sm shadow-black/5"
                    data-testid="storage-section"
                  >
                    <h3 className="text-base font-semibold text-foreground">
                      Storage
                    </h3>
                    <InlineTextBlock
                      label="This period"
                      value={`${formatNumber(usageHours.storageGibHours)} GiB-hours`}
                    />
                    <UsageTrendPanel
                      rows={rows}
                      periodStart={chartPeriodStart}
                      periodEnd={chartPeriodEnd}
                      bucket={chartBucket}
                      metric="storage"
                    />
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getSeriesPath(points: Array<{ x: number; y: number }>): string | null {
  if (points.length === 0) return null
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")
}

function getSeriesPoints({
  rows,
  periodStart,
  periodEnd,
  metric,
  bucketMs,
  plotWidth,
  plotHeight,
  padding,
}: {
  rows: BillingUsageHourly[]
  periodStart: string
  periodEnd: string
  metric: UsageMetric
  bucketMs: number
  plotWidth: number
  plotHeight: number
  padding: { top: number; right: number; bottom: number; left: number }
}) {
  const periodStartMs = new Date(periodStart).getTime()
  const periodEndMs = new Date(periodEnd).getTime()
  const periodMs = Math.max(periodEndMs - periodStartMs, 1)
  const chartPoints = buildUsageChartPoints({
    rows,
    periodStart,
    periodEnd,
    metric,
    bucketMs,
  })
  const values = chartPoints.map((point) => point.value)
  const maxValue = Math.max(...values, 0)
  const yMax = maxValue > 0 ? maxValue : 1

  return {
    yMax,
    points: chartPoints.map((point) => {
      const value = point.value
      const bucketStartMs = new Date(point.bucket_start).getTime()
      const x =
        padding.left +
        Math.min(Math.max((bucketStartMs - periodStartMs) / periodMs, 0), 1) *
          plotWidth
      const y = padding.top + (1 - value / yMax) * plotHeight
      return { x, y, value, bucketStart: point.bucket_start }
    }),
  }
}

function CombinedComputeTrendPanel({
  rows,
  periodStart,
  periodEnd,
  bucket,
}: {
  rows: BillingUsageHourly[]
  periodStart: string
  periodEnd: string
  bucket: UsageChartBucket
}) {
  const width = 380
  const height = 220
  const padding = { top: 18, right: 42, bottom: 34, left: 42 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const computeSeries = getSeriesPoints({
    rows,
    periodStart,
    periodEnd,
    metric: "vcpu",
    bucketMs: bucket.ms,
    plotWidth,
    plotHeight,
    padding,
  })
  const memorySeries = getSeriesPoints({
    rows,
    periodStart,
    periodEnd,
    metric: "memory",
    bucketMs: bucket.ms,
    plotWidth,
    plotHeight,
    padding,
  })

  const computePath = getSeriesPath(computeSeries.points)
  const memoryPath = getSeriesPath(memorySeries.points)
  const leftTicks = [computeSeries.yMax, computeSeries.yMax / 2, 0]
  const rightTicks = [memorySeries.yMax, memorySeries.yMax / 2, 0]

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="size-2 bg-primary" />
          vCPU
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2 bg-success" />
          GiB memory
        </span>
      </div>
      <svg
        className="mt-3 h-56 w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        aria-label={`Combined compute ${bucket.label} line graph`}
        role="img"
      >
        <title>{`Combined compute ${bucket.label} line graph`}</title>
        {leftTicks.map((tick) => {
          const y = padding.top + (1 - tick / computeSeries.yMax) * plotHeight
          return (
            <g key={`compute-${tick}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeDasharray="3 4"
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted font-mono text-[10px]"
              >
                {formatNumber(tick)}
              </text>
            </g>
          )
        })}
        {rightTicks.map((tick) => {
          const y = padding.top + (1 - tick / memorySeries.yMax) * plotHeight
          return (
            <g key={`memory-${tick}`}>
              <text
                x={width - padding.right + 8}
                y={y + 4}
                textAnchor="start"
                className="fill-muted font-mono text-[10px]"
              >
                {formatNumber(tick)}
              </text>
            </g>
          )
        })}
        <text
          x={padding.left}
          y={padding.top - 4}
          textAnchor="start"
          className="fill-muted font-mono text-[10px]"
        >
          vCPU
        </text>
        <text
          x={width - padding.right}
          y={padding.top - 4}
          textAnchor="end"
          className="fill-muted font-mono text-[10px]"
        >
          GiB
        </text>
        <line
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={height - padding.bottom}
          className="stroke-border"
        />
        <line
          x1={width - padding.right}
          x2={width - padding.right}
          y1={padding.top}
          y2={height - padding.bottom}
          className="stroke-border"
        />
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
          className="stroke-border"
        />
        {computePath && (
          <path
            d={computePath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary"
          />
        )}
        {memoryPath && (
          <path
            d={memoryPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-success"
          />
        )}
        {computeSeries.points[computeSeries.points.length - 1] && (
          <circle
            cx={computeSeries.points[computeSeries.points.length - 1].x}
            cy={computeSeries.points[computeSeries.points.length - 1].y}
            r="4"
            fill="currentColor"
            stroke="var(--color-surface)"
            strokeWidth="2"
            className="text-primary"
          />
        )}
        {memorySeries.points[memorySeries.points.length - 1] && (
          <circle
            cx={memorySeries.points[memorySeries.points.length - 1].x}
            cy={memorySeries.points[memorySeries.points.length - 1].y}
            r="4"
            fill="currentColor"
            stroke="var(--color-surface)"
            strokeWidth="2"
            className="text-success"
          />
        )}
        <text
          x={padding.left}
          y={height - 8}
          textAnchor="start"
          className="fill-muted font-mono text-[10px]"
          suppressHydrationWarning
        >
          {new Date(periodStart).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
        <text
          x={width - padding.right}
          y={height - 8}
          textAnchor="end"
          className="fill-muted font-mono text-[10px]"
          suppressHydrationWarning
        >
          {new Date(periodEnd).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
      </svg>
    </div>
  )
}

function UsageTrendPanel({
  rows,
  periodStart,
  periodEnd,
  bucket,
  metric,
}: {
  rows: BillingUsageHourly[]
  periodStart: string
  periodEnd: string
  bucket: UsageChartBucket
  metric: UsageMetric
}) {
  const width = 360
  const height = 190
  const padding = { top: 16, right: 12, bottom: 34, left: 44 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const periodStartMs = new Date(periodStart).getTime()
  const periodEndMs = new Date(periodEnd).getTime()
  const periodMs = Math.max(periodEndMs - periodStartMs, 1)
  const chartPoints = buildUsageChartPoints({
    rows,
    periodStart,
    periodEnd,
    metric,
    bucketMs: bucket.ms,
  })
  const values = chartPoints.map((point) => point.value)
  const maxValue = Math.max(...values, 0)
  const yMax = maxValue > 0 ? maxValue : 1
  const yTicks = [yMax, yMax / 2, 0]

  const points = chartPoints.map((point) => {
    const value = point.value
    const bucketStartMs = new Date(point.bucket_start).getTime()
    const x =
      padding.left +
      Math.min(Math.max((bucketStartMs - periodStartMs) / periodMs, 0), 1) *
        plotWidth
    const y = padding.top + (1 - value / yMax) * plotHeight
    return { x, y, value, bucketStart: point.bucket_start }
  })
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")
  return (
    <div>
      <svg
        className="h-48 w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        aria-label={`Storage ${bucket.label} line graph`}
        role="img"
      >
        <title>{`Storage ${bucket.label} line graph`}</title>
        {yTicks.map((tick) => {
          const y = padding.top + (1 - tick / yMax) * plotHeight
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeDasharray="3 4"
              />
              <text
                x={padding.left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-muted font-mono text-[10px]"
              >
                {formatNumber(tick)}
              </text>
            </g>
          )
        })}
        <line
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={height - padding.bottom}
          className="stroke-border"
        />
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
          className="stroke-border"
        />
        {path && (
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {points[points.length - 1] && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="4"
            fill="currentColor"
            stroke="var(--color-surface)"
            strokeWidth="2"
          />
        )}
        <text
          x={padding.left}
          y={height - 8}
          textAnchor="start"
          className="fill-muted font-mono text-[10px]"
          suppressHydrationWarning
        >
          {new Date(periodStart).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
        <text
          x={width - padding.right}
          y={height - 8}
          textAnchor="end"
          className="fill-muted font-mono text-[10px]"
          suppressHydrationWarning
        >
          {new Date(periodEnd).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
      </svg>
    </div>
  )
}

function InlineMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="font-mono text-sm font-medium text-foreground">
        {formatNumber(value)}
      </span>
    </div>
  )
}

function InlineTextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}
