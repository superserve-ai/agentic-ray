import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockCreateClient = vi.fn()
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

const mockCreateAdminClient = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import {
  cellFor,
  configuredRegions,
  creatableRegions,
  DEFAULT_REGION,
} from "./cells"

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

describe("admin client reuse", () => {
  beforeEach(() => {
    mockCreateClient.mockClear()
    mockCreateClient.mockImplementation(() => ({}))
    process.env.SUPABASE_USWEST_URL = "https://usw.supabase.test"
  })

  it("returns the same usw client across calls", () => {
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "svc-key-reuse"
    cellFor("usw").createAdminClient()
    cellFor("usw").createAdminClient()
    expect(mockCreateClient).toHaveBeenCalledTimes(1)
  })

  it("builds a fresh client when the credentials change", () => {
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "svc-key-a"
    cellFor("usw").createAdminClient()
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "svc-key-b"
    cellFor("usw").createAdminClient()
    expect(mockCreateClient).toHaveBeenCalledTimes(2)
  })
})

describe("multi-cell UI allowlist", () => {
  beforeEach(() => {
    process.env.SUPABASE_USWEST_URL = "https://usw.supabase.test"
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "svc-key"
    delete process.env.MULTI_CELL_UI_ALLOWLIST
  })

  it("offers only the default region without an allowlist, even with usw live", () => {
    expect(creatableRegions("dev@superserve.ai")).toEqual(["use"])
  })

  it("matches @domain entries case-insensitively", () => {
    process.env.MULTI_CELL_UI_ALLOWLIST = "@superserve.ai"
    expect(creatableRegions("Dev@Superserve.AI")).toEqual(["use", "usw"])
    expect(creatableRegions("someone@customer.com")).toEqual(["use"])
  })

  it("matches exact-email entries and ignores list whitespace", () => {
    process.env.MULTI_CELL_UI_ALLOWLIST = " pilot@acme.com , @superserve.ai "
    expect(creatableRegions("pilot@acme.com")).toEqual(["use", "usw"])
    expect(creatableRegions("other@acme.com")).toEqual(["use"])
  })

  it("denies undefined emails", () => {
    process.env.MULTI_CELL_UI_ALLOWLIST = "@superserve.ai"
    expect(creatableRegions(undefined)).toEqual(["use"])
  })
})
