import { describe, expect, it } from "vitest"

import { buildUsageChartPoints } from "./usage-chart"

const PERIOD_START = "2026-06-01T00:00:00.000Z"
const PERIOD_END = "2026-06-01T02:00:00.000Z"
const HOUR_MS = 60 * 60 * 1000

const rows = [
  {
    hour_start: "2026-06-01T00:00:00.000Z",
    hour_end: "2026-06-01T01:00:00.000Z",
    vcpu_seconds: 3600,
    memory_mib_seconds: 4096 * 3600,
    storage_mib_seconds: 8192 * 3600,
    updated_at: "2026-06-01T01:05:00.000Z",
  },
  {
    hour_start: "2026-06-01T01:00:00.000Z",
    hour_end: "2026-06-01T02:00:00.000Z",
    vcpu_seconds: 7200,
    memory_mib_seconds: 2048 * 3600,
    storage_mib_seconds: 4096 * 3600,
    updated_at: "2026-06-01T02:05:00.000Z",
  },
]

describe("buildUsageChartPoints", () => {
  it("uses distinct source fields for CPU, memory, and storage", () => {
    const cpu = buildUsageChartPoints({
      rows,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      metric: "vcpu",
      bucketMs: HOUR_MS,
    })
    const memory = buildUsageChartPoints({
      rows,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      metric: "memory",
      bucketMs: HOUR_MS,
    })
    const storage = buildUsageChartPoints({
      rows,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      metric: "storage",
      bucketMs: HOUR_MS,
    })

    expect(cpu.map((point) => point.value)).toEqual([1, 2])
    expect(memory.map((point) => point.value)).toEqual([4, 2])
    expect(storage.map((point) => point.value)).toEqual([8, 4])
    expect(memory[0]).toMatchObject({
      bucket_start: "2026-06-01T00:00:00.000Z",
      bucket_end: "2026-06-01T01:00:00.000Z",
      usage_hours: 4,
    })
  })
})
