"use client"

import {
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  LightningIcon,
} from "@phosphor-icons/react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@superserve/ui"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { DateRangeFilter, type DateRange } from "@/components/date-range-filter"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { TableSkeleton } from "@/components/table-skeleton"
import { useBillingUsage } from "@/hooks/use-billing-usage"
import { useUser } from "@/hooks/use-user"
import type {
  BillingPricing,
  BillingUsageHourly,
} from "@/lib/api/billing-actions"

import {
  buildUsageChartPoints,
  getUsageChartBucket,
  type UsageChartBucket,
  type UsageMetric,
} from "./usage-chart"

const EMPTY_ROWS: BillingUsageHourly[] = []
const EMPTY_PRICING: BillingPricing = {
  cpu_vcpu_hour_usd: 0,
  memory_gib_hour_usd: 0,
  storage_gib_hour_usd: 0,
  source: "api",
}

function defaultRange(): DateRange {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 7)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatRate(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.001 ? 6 : 4,
    maximumFractionDigits: value < 0.001 ? 6 : 4,
  }).format(value)
}

function formatUpdatedAt(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export function PlanUsagePageClient() {
  const router = useRouter()
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultRange())
  const { user, loading: userLoading } = useUser()
  const { data, isPending, error, refetch } = useBillingUsage(
    dateRange.start,
    dateRange.end,
    !userLoading && !!user,
  )
  const rows = data?.rows ?? EMPTY_ROWS
  const latestUpdatedAt = rows[rows.length - 1]?.updated_at
  const isBillingPreview = data?.billing_mode === "shadow"
  const pricing = data?.pricing ?? EMPTY_PRICING
  const chartPeriod = {
    start: data?.period_start ?? dateRange.start.toISOString(),
    end: data?.period_end ?? dateRange.end.toISOString(),
  }
  const chartBucket = getUsageChartBucket(chartPeriod.start, chartPeriod.end)

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
  const estimates = useMemo(
    () => ({
      cpuUsd: usageHours.vcpuHours * pricing.cpu_vcpu_hour_usd,
      memoryUsd: usageHours.memoryGibHours * pricing.memory_gib_hour_usd,
      storageUsd: usageHours.storageGibHours * pricing.storage_gib_hour_usd,
    }),
    [usageHours, pricing],
  )
  const estimateLabel =
    data?.billing_mode === "active" ? "Estimated spend" : "Preview estimate"

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Plan & Usage" />

      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <p className="text-sm text-muted">
          Billing usage is scoped to your authenticated team. Ranges are capped
          at 90 days.
          {isBillingPreview
            ? "You are not being charged for this usage yet."
            : ""}
        </p>
        <DateRangeFilter
          value={dateRange}
          onChange={(range) => {
            if (range) setDateRange(range)
          }}
        />
      </div>

      {userLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="border-foreground/20 border-t-foreground" />
        </div>
      ) : !user ? (
        <EmptyState
          icon={LightningIcon}
          title="Sign In Required"
          description="Your session is missing or expired. Sign in again to view plan usage."
          actionLabel="Sign In"
          onAction={() => router.push("/auth/signin?next=/plan-usage")}
        />
      ) : isPending ? (
        <TableSkeleton columns={5} />
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : data?.enabled === false ? (
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
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {isBillingPreview && (
            <div className="border border-dashed border-border bg-brand/5 px-4 py-3 text-sm text-foreground">
              Your team is not being charged for this usage yet.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <UsageCard
              title="CPU Usage"
              usage={`${formatNumber(usageHours.vcpuHours)} vCPU hours`}
              rate={`${formatRate(pricing.cpu_vcpu_hour_usd)} / vCPU-hour`}
              estimateLabel={estimateLabel}
              estimate={formatCurrency(estimates.cpuUsd)}
            />
            <UsageCard
              title="Memory Usage"
              usage={`${formatNumber(usageHours.memoryGibHours)} GiB memory hours`}
              rate={`${formatRate(pricing.memory_gib_hour_usd)} / GiB-hour`}
              estimateLabel={estimateLabel}
              estimate={formatCurrency(estimates.memoryUsd)}
            />
            <UsageCard
              title="Active Storage"
              usage={`${formatNumber(usageHours.storageGibHours)} GiB storage hours`}
              rate={`${formatRate(pricing.storage_gib_hour_usd)} / GiB-hour`}
              estimateLabel={estimateLabel}
              estimate={formatCurrency(estimates.storageUsd)}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Usage Trends
              </h2>
              <p className="mt-1 text-sm text-muted">
                {chartBucket.label === "hour"
                  ? "Hourly rollups across the selected period."
                  : `Hourly rollups grouped into ${chartBucket.label} buckets across the selected period.`}
              </p>
            </div>
            {latestUpdatedAt && (
              <div
                className="flex items-center gap-2 font-mono text-xs text-muted uppercase"
                suppressHydrationWarning
              >
                <ClockCounterClockwiseIcon className="size-4" />
                Updated {formatUpdatedAt(latestUpdatedAt)}
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <UsageChartCard
              title="CPU Usage"
              description={`Average vCPU per ${chartBucket.label}`}
              rows={rows}
              periodStart={chartPeriod.start}
              periodEnd={chartPeriod.end}
              bucket={chartBucket}
              valueLabel="vCPU"
              usageLabel="vCPU hours"
              hourlyRateUsd={pricing.cpu_vcpu_hour_usd}
              strokeClassName="text-success"
              metric="vcpu"
            />
            <UsageChartCard
              title="Memory Usage"
              description={`Average GiB memory per ${chartBucket.label}`}
              rows={rows}
              periodStart={chartPeriod.start}
              periodEnd={chartPeriod.end}
              bucket={chartBucket}
              valueLabel="GiB"
              usageLabel="GiB memory hours"
              hourlyRateUsd={pricing.memory_gib_hour_usd}
              strokeClassName="text-success"
              metric="memory"
            />
            <UsageChartCard
              title="Active Storage"
              description={`Average GiB storage per ${chartBucket.label}`}
              rows={rows}
              periodStart={chartPeriod.start}
              periodEnd={chartPeriod.end}
              bucket={chartBucket}
              valueLabel="GiB"
              usageLabel="GiB storage hours"
              hourlyRateUsd={pricing.storage_gib_hour_usd}
              strokeClassName="text-success"
              metric="storage"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function formatChartTick(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function formatChartDateRange(start: string, end: string): string {
  const startDate = new Date(start)
  const endDate = new Date(end)
  return `${startDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })} - ${endDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })}`
}

function formatPointTooltip({
  title,
  bucketStart,
  bucketEnd,
  usageHours,
  usageLabel,
  averageValue,
  valueLabel,
  priceUsd,
}: {
  title: string
  bucketStart: string
  bucketEnd: string
  usageHours: number
  usageLabel: string
  averageValue: number
  valueLabel: string
  priceUsd: number
}): string {
  return [
    title,
    `Range: ${formatChartDateRange(bucketStart, bucketEnd)}`,
    `Usage: ${formatNumber(usageHours)} ${usageLabel}`,
    `Average: ${formatNumber(averageValue)} ${valueLabel}`,
    `Price: ${formatCurrency(priceUsd)}`,
  ].join("\n")
}

function UsageChartCard({
  title,
  description,
  rows,
  periodStart,
  periodEnd,
  bucket,
  valueLabel,
  usageLabel,
  hourlyRateUsd,
  strokeClassName,
  metric,
}: {
  title: string
  description: string
  rows: BillingUsageHourly[]
  periodStart: string
  periodEnd: string
  bucket: UsageChartBucket
  valueLabel: string
  usageLabel: string
  hourlyRateUsd: number
  strokeClassName: string
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
    return {
      x,
      y,
      value,
      bucketStart: point.bucket_start,
      bucketEnd: point.bucket_end,
      usageHours: point.usage_hours,
      priceUsd: point.usage_hours * hourlyRateUsd,
    }
  })
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="mb-3 flex justify-end">
          <p className="font-mono text-xs text-muted uppercase">
            Latest {valueLabel}
          </p>
        </div>
        <svg
          className={`h-48 w-full overflow-visible ${strokeClassName}`}
          viewBox={`0 0 ${width} ${height}`}
          aria-label={`${title} ${bucket.label} line graph`}
        >
          <title
            suppressHydrationWarning
          >{`${title} ${bucket.label} line graph`}</title>
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
          {points.map((point) => {
            const tooltip = formatPointTooltip({
              title,
              bucketStart: point.bucketStart,
              bucketEnd: point.bucketEnd,
              usageHours: point.usageHours,
              usageLabel,
              averageValue: point.value,
              valueLabel,
              priceUsd: point.priceUsd,
            })
            return (
              <g key={point.bucketStart}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="9"
                  fill="transparent"
                  pointerEvents="all"
                >
                  <title>{tooltip}</title>
                </circle>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="3.75"
                  fill="currentColor"
                  stroke="var(--color-surface)"
                  strokeWidth="2"
                  pointerEvents="none"
                />
              </g>
            )
          })}
          <text
            x={padding.left}
            y={height - 8}
            textAnchor="start"
            className="fill-muted font-mono text-[10px]"
            suppressHydrationWarning
          >
            {formatChartTick(periodStart)}
          </text>
          <text
            x={width - padding.right}
            y={height - 8}
            textAnchor="end"
            className="fill-muted font-mono text-[10px]"
            suppressHydrationWarning
          >
            {formatChartTick(periodEnd)}
          </text>
        </svg>
      </CardContent>
    </Card>
  )
}

function UsageCard({
  title,
  usage,
  rate,
  estimateLabel,
  estimate,
}: {
  title: string
  usage: string
  rate: string
  estimateLabel: string
  estimate: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{usage}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="font-mono text-sm text-muted">{rate}</p>
        <p className="text-sm text-foreground">
          {estimateLabel}: <span className="font-mono text-lg">{estimate}</span>
        </p>
      </CardContent>
    </Card>
  )
}
