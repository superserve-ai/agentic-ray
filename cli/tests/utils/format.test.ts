import { describe, expect, test } from "bun:test"
import {
  formatDuration,
  formatElapsed,
  formatSize,
  formatTimestamp,
} from "../../src/utils/format"

describe("formatDuration", () => {
  test("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms")
    expect(formatDuration(0)).toBe("0ms")
    expect(formatDuration(999)).toBe("999ms")
  })

  test("formats seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s")
    expect(formatDuration(1500)).toBe("1.5s")
    expect(formatDuration(59999)).toBe("60.0s")
  })

  test("formats minutes", () => {
    expect(formatDuration(60000)).toBe("1.0m")
    expect(formatDuration(90000)).toBe("1.5m")
  })
})

describe("formatElapsed", () => {
  test("formats seconds", () => {
    expect(formatElapsed(0)).toBe("0s")
    expect(formatElapsed(45)).toBe("45s")
    expect(formatElapsed(59)).toBe("59s")
  })

  test("formats minutes and seconds", () => {
    expect(formatElapsed(60)).toBe("1m 0s")
    expect(formatElapsed(150)).toBe("2m 30s")
    expect(formatElapsed(3661)).toBe("61m 1s")
  })
})

describe("formatSize", () => {
  test("formats KB", () => {
    expect(formatSize(1024)).toBe("1 KB")
    expect(formatSize(50 * 1024)).toBe("50 KB")
  })

  test("formats MB", () => {
    expect(formatSize(100 * 1024)).toBe("0.1 MB")
    expect(formatSize(1024 * 1024)).toBe("1.0 MB")
    expect(formatSize(5.5 * 1024 * 1024)).toBe("5.5 MB")
  })
})

describe("formatTimestamp", () => {
  test("returns empty string for empty input", () => {
    expect(formatTimestamp("")).toBe("")
  })

  test("formats ISO timestamp", () => {
    const result = formatTimestamp("2024-01-15T10:30:00Z")
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(0)
  })

  test("short format", () => {
    const result = formatTimestamp("2024-01-15T10:30:00Z", true)
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(0)
  })

  test("handles invalid timestamps gracefully", () => {
    const result = formatTimestamp("not-a-date")
    expect(result).toBeTruthy()
  })
})
