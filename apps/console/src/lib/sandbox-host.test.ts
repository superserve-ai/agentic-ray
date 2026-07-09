import { describe, expect, it } from "vitest"

import { regionFromSandboxId, sandboxHostFor } from "./sandbox-host"

const UUID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"

describe("regionFromSandboxId", () => {
  it("extracts the region token from a prefixed id", () => {
    expect(regionFromSandboxId(`sb-usw-${UUID}`)).toBe("usw")
    expect(regionFromSandboxId(`sb-use-${UUID}`)).toBe("use")
  })

  it("returns undefined for legacy/bare ids", () => {
    expect(regionFromSandboxId(UUID)).toBeUndefined()
    expect(regionFromSandboxId("sbx-1")).toBeUndefined()
  })
})

describe("sandboxHostFor", () => {
  it("routes a usw sandbox to the usw data-plane host", () => {
    expect(sandboxHostFor(`sb-usw-${UUID}`)).toBe("usw-sandbox.superserve.ai")
  })

  it("routes the default cell and legacy ids to the default host, never the usw host", () => {
    const legacy = sandboxHostFor(UUID)
    const use = sandboxHostFor(`sb-use-${UUID}`)
    expect(use).toBe(legacy)
    expect(use).not.toBe("usw-sandbox.superserve.ai")
  })
})
