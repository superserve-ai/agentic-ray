import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { DateRangeFilter, parseDateInput } from "./date-range-filter"

describe("DateRangeFilter", () => {
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

    // Days 1 and 2 of the current month are always in the calendar's initial
    // view; deriving them keeps the test from expiring with the calendar
    // month (hardcoded June dates broke when July started).
    const start = new Date()
    start.setDate(2)
    const end = new Date()
    end.setDate(1)

    await user.click(
      screen.getByRole("button", { name: "Select a custom date range" }),
    )
    await user.click(screen.getByRole("button", { name: start.toDateString() }))
    await user.click(screen.getByRole("button", { name: end.toDateString() }))
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(
      screen.getByText("End date must be on or after the start date."),
    ).toBeInTheDocument()
  })
})
