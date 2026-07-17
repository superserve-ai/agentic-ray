import { beforeEach, describe, expect, it, vi } from "vitest"

const getImpersonationContext = vi.hoisted(() => vi.fn())
const canReadPlatformActivity = vi.hoisted(() => vi.fn())
const resolveActiveTeam = vi.hoisted(() => vi.fn())
const createServerClient = vi.hoisted(() => vi.fn())
const cellFor = vi.hoisted(() => vi.fn())

const query = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn(async () => ({ data: [], error: null }))
  return chain
})

vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext,
}))

vi.mock("@/lib/admin/permissions", () => ({
  canReadPlatformActivity,
}))

vi.mock("@/lib/api/active-team", () => ({
  resolveActiveTeam,
}))

vi.mock("@/lib/cells", () => ({
  cellFor,
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient,
}))

import { listActivityBySandboxAction } from "./activity-actions"

const user = {
  id: "admin-1",
  email: "admin@superserve.ai",
  app_metadata: { permissions: ["platform:activity:read"] },
}

describe("listActivityBySandboxAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServerClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    })
    cellFor.mockReturnValue({
      createAdminClient: () => ({ from: vi.fn(() => query) }),
    })
  })

  it("reads the impersonated team in its home region", async () => {
    getImpersonationContext.mockResolvedValue({
      teamId: "team-target",
      region: "usw",
      teamName: "Target",
    })
    canReadPlatformActivity.mockReturnValue(true)

    await listActivityBySandboxAction("sandbox-1")

    expect(cellFor).toHaveBeenCalledWith("usw")
    expect(query.eq).toHaveBeenCalledWith("sandbox_id", "sandbox-1")
    expect(query.eq).toHaveBeenCalledWith("team_id", "team-target")
    expect(resolveActiveTeam).not.toHaveBeenCalled()
  })

  it("fails closed when impersonation lacks activity access", async () => {
    getImpersonationContext.mockResolvedValue({
      teamId: "team-target",
      region: "use",
      teamName: "Target",
    })
    canReadPlatformActivity.mockReturnValue(false)

    await expect(listActivityBySandboxAction("sandbox-1")).rejects.toThrow(
      /platform activity read access required/,
    )
    expect(cellFor).not.toHaveBeenCalled()
    expect(resolveActiveTeam).not.toHaveBeenCalled()
  })

  it("keeps normal users on their active team", async () => {
    getImpersonationContext.mockResolvedValue(null)
    resolveActiveTeam.mockResolvedValue({ teamId: "team-self", region: "use" })

    await listActivityBySandboxAction("sandbox-1")

    expect(cellFor).toHaveBeenCalledWith("use")
    expect(query.eq).toHaveBeenCalledWith("team_id", "team-self")
  })
})
