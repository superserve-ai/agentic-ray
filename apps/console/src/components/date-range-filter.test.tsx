import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DateRangeFilter, parseDateInput } from "./date-range-filter"

describe("DateRangeFilter", () => {
  // The calendar opens on the current month (`new Date()`), and the inverted-range
  // test clicks hardcoded June 2026 days. Pin the clock to mid-June 2026 so those
  // days always render, regardless of when the suite runs. Fake only `Date` —
  // userEvent relies on real timers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rejects invalid calendar dates", () => {
    expect(parseDateInput("2026-02-30")).toBeNull()
    expect(parseDateInput("2026-13-01")).toBeNull()
  })

  it("rejects invalid custom ranges without calling onChange", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<DateRangeFilter value={null} onChange={onChange} />)

    await user.click(
      screen.getByRole("button", { name: "Select a custom date range" }),
    )
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it("rejects an inverted range without calling onChange", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<DateRangeFilter value={null} onChange={onChange} />)

    await user.click(
      screen.getByRole("button", { name: "Select a custom date range" }),
    )
    await user.click(screen.getByRole("button", { name: "Tue Jun 02 2026" }))
    await user.click(screen.getByRole("button", { name: "Mon Jun 01 2026" }))
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(
      screen.getByText("End date must be on or after the start date."),
    ).toBeInTheDocument()
  })
})
