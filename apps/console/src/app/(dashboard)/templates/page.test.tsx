import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockTemplatesPageClient } = vi.hoisted(() => ({
  mockTemplatesPageClient: vi.fn(() => null),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))
vi.mock("./templates-page-client", () => ({
  default: mockTemplatesPageClient,
}))

import { redirect } from "next/navigation"

import { createServerClient } from "@/lib/supabase/server"

import TemplatesPage from "./page"

describe("TemplatesPage", () => {
  beforeEach(() => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as never)
    vi.mocked(redirect).mockClear()
    mockTemplatesPageClient.mockClear()
  })

  it("redirects unauthenticated users to sign-in", async () => {
    await expect(TemplatesPage()).rejects.toThrow(
      "redirect:/auth/signin?next=/templates",
    )
    expect(mockTemplatesPageClient).not.toHaveBeenCalled()
  })

  it("renders the templates client for authenticated customers without platform permissions", async () => {
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

    const element = await TemplatesPage()

    expect(element.type).toBe(mockTemplatesPageClient)
    expect(mockTemplatesPageClient).not.toHaveBeenCalled()
  })

  it("renders the templates client for staff users without platform template read access", async () => {
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

    const element = await TemplatesPage()

    expect(element.type).toBe(mockTemplatesPageClient)
  })
})
