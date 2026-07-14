import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockUseTemplate, mockUseRebuildTemplate } = vi.hoisted(() => ({
  mockUseTemplate: vi.fn(),
  mockUseRebuildTemplate: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ template_id: "template-1" }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@/hooks/use-templates", () => ({
  useTemplate: (...args: unknown[]) => mockUseTemplate(...args),
  useRebuildTemplate: () => mockUseRebuildTemplate(),
}))

import TemplateDetailPageClient from "./template-detail-page-client"

describe("TemplateDetailPageClient", () => {
  beforeEach(() => {
    mockUseTemplate.mockReturnValue({
      data: null,
      isPending: false,
      error: new Error("Forbidden: team RBAC denied"),
      refetch: vi.fn(),
    })
    mockUseRebuildTemplate.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
  })

  it("surfaces backend API errors instead of preempting them in the page gate", () => {
    render(<TemplateDetailPageClient />)

    expect(screen.getByText("Forbidden: team RBAC denied")).toBeInTheDocument()
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
  })
})
