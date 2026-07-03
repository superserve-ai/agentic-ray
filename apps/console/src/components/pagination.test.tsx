import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Pagination } from "./pagination"

const noop = () => {}

describe("Pagination", () => {
  it("renders the current range and total", () => {
    render(
      <Pagination
        page={1}
        pageSize={50}
        total={120}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    )
    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toHaveTextContent("1–50 of 120")
  })

  it("clamps the range end to the total on the last, partial page", () => {
    render(
      <Pagination
        page={3}
        pageSize={50}
        total={120}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    )
    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toHaveTextContent("101–120 of 120")
  })

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender } = render(
      <Pagination
        page={1}
        pageSize={50}
        total={120}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    )
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next page" })).not.toBeDisabled()

    rerender(
      <Pagination
        page={3}
        pageSize={50}
        total={120}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    )
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
  })

  it("calls onPageChange with the clicked page number", async () => {
    const onPageChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Pagination
        page={1}
        pageSize={50}
        total={120}
        onPageChange={onPageChange}
        onPageSizeChange={noop}
      />,
    )
    await user.click(screen.getByRole("button", { name: "2" }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it("elides distant pages in a long range but always shows first and last", () => {
    // 1000 rows / 50 per page = 20 pages, viewing page 10.
    render(
      <Pagination
        page={10}
        pageSize={50}
        total={1000}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    )
    // First, last, and the current neighborhood are present…
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "20" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "10" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "9" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "11" })).toBeInTheDocument()
    // …but distant pages are elided.
    expect(screen.queryByRole("button", { name: "5" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "15" })).not.toBeInTheDocument()
  })

  it("shows a single page and disables both arrows when the list fits one page", () => {
    render(
      <Pagination
        page={1}
        pageSize={50}
        total={3}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    )
    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toHaveTextContent("1–3 of 3")
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
  })
})
