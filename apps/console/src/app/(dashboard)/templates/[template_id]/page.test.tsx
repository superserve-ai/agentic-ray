import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockTemplateDetailPageClient } = vi.hoisted(() => ({
  mockTemplateDetailPageClient: vi.fn(() => null),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))
vi.mock("./template-detail-page-client", () => ({
  default: mockTemplateDetailPageClient,
}))

import { redirect } from "next/navigation"

import { createServerClient } from "@/lib/supabase/server"

import TemplateDetailPage from "./page"

describe("TemplateDetailPage", () => {
  beforeEach(() => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as never)
    vi.mocked(redirect).mockClear()
    mockTemplateDetailPageClient.mockClear()
  })

  it("redirects unauthenticated users to sign-in", async () => {
    await expect(TemplateDetailPage()).rejects.toThrow(
      "redirect:/auth/signin?next=/templates",
    )
    expect(mockTemplateDetailPageClient).not.toHaveBeenCalled()
  })

  it("renders the detail client for authenticated customers without platform permissions", async () => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: "customer-1",
              email: "customer@example.com",
              app_metadata: { permissions: [] },
            },
          },
        }),
      },
    } as never)

    const element = await TemplateDetailPage()

    expect(element.type).toBe(mockTemplateDetailPageClient)
    expect(mockTemplateDetailPageClient).not.toHaveBeenCalled()
  })

  it("renders the detail client for staff users without platform template read access", async () => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: "staff-1",
              email: "staff@example.com",
              app_metadata: {
                provider: "google",
                permissions: [],
              },
            },
          },
        }),
      },
    } as never)

    const element = await TemplateDetailPage()

    expect(element.type).toBe(mockTemplateDetailPageClient)
  })
})
