import type { CapturedNetworkRequest } from "posthog-js"
import { describe, expect, it } from "vitest"

import { redactPreviewToken } from "./posthog-provider"

function request(name: string): CapturedNetworkRequest {
  return {
    name,
    duration: 0,
    entryType: "resource",
    startTime: 0,
  }
}

describe("redactPreviewToken", () => {
  it("redacts preview credentials from absolute captured URLs", () => {
    const result = redactPreviewToken(
      request(
        "https://3000-sbx.sandbox.superserve.ai/?superserve_preview_token=secret&view=full",
      ),
    )

    expect(result.name).toBe(
      "https://3000-sbx.sandbox.superserve.ai/?superserve_preview_token=redacted&view=full",
    )
  })

  it("redacts preview credentials from relative captured URLs", () => {
    const result = redactPreviewToken(
      request("/preview?superserve_preview_token=secret#app"),
    )

    expect(result.name).toBe("/preview?superserve_preview_token=redacted#app")
  })

  it("leaves unrelated requests unchanged", () => {
    const original = request("https://console.superserve.ai/sandboxes")
    expect(redactPreviewToken(original)).toBe(original)
  })
})
