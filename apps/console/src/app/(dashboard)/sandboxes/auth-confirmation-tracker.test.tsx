import { render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockReplace = vi.fn()
const mockCapture = vi.fn()

vi.mock("next/navigation", () => ({
  usePathname: () => "/sandboxes",
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams("confirmed=email&status=active"),
}))

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))

import { AuthConfirmationTracker } from "./auth-confirmation-tracker"

describe("AuthConfirmationTracker", () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockCapture.mockReset()
    window.sessionStorage.clear()
  })

  it("captures the browser-side sign-in completion once and strips the query param", async () => {
    render(<AuthConfirmationTracker />)

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith("auth_sign_in_completed", {
        method: "email",
      })
    })
    expect(mockReplace).toHaveBeenCalledWith("/sandboxes?status=active")

    render(<AuthConfirmationTracker />)

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledTimes(1)
    })
  })
})
