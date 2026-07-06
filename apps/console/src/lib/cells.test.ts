import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockCreateClient = vi.fn()
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

const mockCreateAdminClient = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { cellFor, configuredRegions, DEFAULT_REGION } from "./cells"

const ORIGINAL_ENV = {
  SANDBOX_API_URL: process.env.SANDBOX_API_URL,
  SANDBOX_API_URL_USWEST: process.env.SANDBOX_API_URL_USWEST,
  SUPABASE_USWEST_URL: process.env.SUPABASE_USWEST_URL,
  SUPABASE_USWEST_SERVICE_ROLE_KEY:
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY,
}

function restoreEnv() {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

describe("cells registry env gating", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_USWEST_URL
    delete process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY
    delete process.env.SANDBOX_API_URL_USWEST
  })

  afterEach(() => {
    restoreEnv()
    vi.clearAllMocks()
  })

  it("offers only the default region when usw env vars are absent", () => {
    expect(configuredRegions()).toEqual([DEFAULT_REGION])
    expect(() => cellFor("usw")).toThrow("Region usw is not configured")
  })

  it("stays dormant when the usw env is only partially configured", () => {
    process.env.SUPABASE_USWEST_URL = "https://usw.supabase.co"
    expect(configuredRegions()).toEqual(["use"])

    delete process.env.SUPABASE_USWEST_URL
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "usw-service-role-key"
    expect(configuredRegions()).toEqual(["use"])
  })

  it("keeps the default cell on the existing admin client and API URL", () => {
    const adminClient = { cell: "use" }
    mockCreateAdminClient.mockReturnValue(adminClient)

    const cell = cellFor("use")
    // setup.ts stubs SANDBOX_API_URL for every test.
    expect(cell.apiBaseUrl).toBe("https://api.test.superserve.ai")
    expect(cell.createAdminClient()).toBe(adminClient)
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it("falls back to the production API URL when SANDBOX_API_URL is unset", () => {
    delete process.env.SANDBOX_API_URL
    expect(cellFor("use").apiBaseUrl).toBe("https://api.superserve.ai")
  })

  it("offers usw once its Supabase env vars are set", () => {
    process.env.SUPABASE_USWEST_URL = "https://usw.supabase.co"
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "usw-service-role-key"

    expect(configuredRegions()).toEqual(["use", "usw"])
    expect(cellFor("usw").apiBaseUrl).toBe("https://api-usw.superserve.ai")
  })

  it("uses SANDBOX_API_URL_USWEST for the usw API when set", () => {
    process.env.SUPABASE_USWEST_URL = "https://usw.supabase.co"
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "usw-service-role-key"
    process.env.SANDBOX_API_URL_USWEST = "https://api-usw.test.superserve.ai"

    expect(cellFor("usw").apiBaseUrl).toBe("https://api-usw.test.superserve.ai")
  })

  it("builds the usw admin client from the usw env vars", () => {
    process.env.SUPABASE_USWEST_URL = "https://usw.supabase.co"
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "usw-service-role-key"
    mockCreateClient.mockReturnValue({})

    cellFor("usw").createAdminClient()

    expect(mockCreateClient).toHaveBeenCalledWith(
      "https://usw.supabase.co",
      "usw-service-role-key",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })
})
