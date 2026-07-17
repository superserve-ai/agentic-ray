import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ActivitySection } from "./activity-section"

describe("ActivitySection", () => {
  it("shows activity query failures instead of an empty state", () => {
    const onRetry = vi.fn()

    render(
      <ActivitySection
        activity={undefined}
        isPending={false}
        error={
          new Error(
            "Forbidden: platform activity read access required while viewing another team",
          )
        }
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText("Unable to load activity")).toBeInTheDocument()
    expect(
      screen.getByText(/platform activity read access required/i),
    ).toBeInTheDocument()
    expect(screen.queryByText("No Activity")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("keeps the empty state for successful empty results", () => {
    render(<ActivitySection activity={[]} isPending={false} error={null} />)

    expect(screen.getByText("No Activity")).toBeInTheDocument()
    expect(
      screen.queryByText("Unable to load activity"),
    ).not.toBeInTheDocument()
  })
})
