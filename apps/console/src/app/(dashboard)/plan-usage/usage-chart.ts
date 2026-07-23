import type { BillingUsageHourly } from "@/lib/api/billing-actions"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

export type UsageMetric = "vcpu" | "memory" | "storage"

export interface UsageChartBucket {
  ms: number
  label: string
}

export interface UsageChartPoint {
  bucket_start: string
  bucket_end: string
  usage_hours: number
  value: number
}

export function getUsageChartBucket(
  periodStart: string,
  periodEnd: string,
): UsageChartBucket {
  const periodMs = Math.max(
    new Date(periodEnd).getTime() - new Date(periodStart).getTime(),
    1,
  )

  if (periodMs <= 2 * DAY_MS) return { ms: HOUR_MS, label: "hour" }
  if (periodMs <= 14 * DAY_MS) return { ms: 6 * HOUR_MS, label: "6 hours" }
  if (periodMs <= 45 * DAY_MS) return { ms: DAY_MS, label: "day" }
  return { ms: WEEK_MS, label: "week" }
}

function getMetricUsageSeconds(
  row: BillingUsageHourly,
  metric: UsageMetric,
): number {
  if (metric === "vcpu") return row.vcpu_seconds
  if (metric === "memory") return row.memory_mib_seconds / 1024
  return row.storage_mib_seconds / 1024
}

export function buildUsageChartPoints({
  rows,
  periodStart,
  periodEnd,
  metric,
  bucketMs,
}: {
  rows: BillingUsageHourly[]
  periodStart: string
  periodEnd: string
  metric: UsageMetric
  bucketMs: number
}): UsageChartPoint[] {
  const periodStartMs = new Date(periodStart).getTime()
  const periodEndMs = new Date(periodEnd).getTime()
  const buckets = new Map<number, number>()

  for (const row of rows) {
    const hourStartMs = new Date(row.hour_start).getTime()
    if (
      Number.isNaN(hourStartMs) ||
      hourStartMs < periodStartMs ||
      hourStartMs >= periodEndMs
    ) {
      continue
    }

    const bucketIndex = Math.floor((hourStartMs - periodStartMs) / bucketMs)
    const bucketStartMs = periodStartMs + bucketIndex * bucketMs
    buckets.set(
      bucketStartMs,
      (buckets.get(bucketStartMs) ?? 0) + getMetricUsageSeconds(row, metric),
    )
  }

  return [...buckets.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([bucketStartMs, usageSeconds]) => {
      const bucketEndMs = Math.min(bucketStartMs + bucketMs, periodEndMs)
      const durationSeconds = Math.max((bucketEndMs - bucketStartMs) / 1000, 1)
      return {
        bucket_start: new Date(bucketStartMs).toISOString(),
        bucket_end: new Date(bucketEndMs).toISOString(),
        usage_hours: usageSeconds / 3600,
        value: usageSeconds / durationSeconds,
      }
    })
}
