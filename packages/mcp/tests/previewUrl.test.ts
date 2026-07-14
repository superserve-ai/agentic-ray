import { describe, expect, it } from "vitest"

import { buildPreviewUrl, PreviewUrlError } from "../src/lib/previewUrl.js"

describe("buildPreviewUrl", () => {
  it("builds {port}-{id}.{host} on the default (prod) host", () => {
    expect(buildPreviewUrl("a1b2c3", 8080)).toBe(
      "https://8080-a1b2c3.sandbox.superserve.ai",
    )
  })

  it("uses the host it is given (region-resolved by the caller)", () => {
    expect(
      buildPreviewUrl("a1b2c3", 4000, "staging-sandbox.superserve.ai"),
    ).toBe("https://4000-a1b2c3.staging-sandbox.superserve.ai")
    expect(
      buildPreviewUrl("sb-usw-a1b2c3", 3000, "usw-sandbox.superserve.ai"),
    ).toBe("https://3000-sb-usw-a1b2c3.usw-sandbox.superserve.ai")
  })

  it("rejects out-of-range and non-integer ports", () => {
    expect(() => buildPreviewUrl("id", 0)).toThrow(PreviewUrlError)
    expect(() => buildPreviewUrl("id", 65536)).toThrow(PreviewUrlError)
    expect(() => buildPreviewUrl("id", 80.5)).toThrow(PreviewUrlError)
    expect(() => buildPreviewUrl("id", -1)).toThrow(PreviewUrlError)
  })

  // Privileged ports (< 1024) are refused by the edge proxy, so a URL to one
  // would never route — reject up front, matching the SDK's builder.
  it("rejects privileged ports (< 1024)", () => {
    expect(() => buildPreviewUrl("id", 80)).toThrow(PreviewUrlError)
    expect(() => buildPreviewUrl("id", 1023)).toThrow(PreviewUrlError)
    expect(buildPreviewUrl("id", 1024)).toBe(
      "https://1024-id.sandbox.superserve.ai",
    )
  })

  // A sandbox id is caller-controlled; a `.`/`/`/`@` could re-point the host.
  // Use a valid (>=1024) port so the id check is what rejects, not the port.
  it("rejects a sandbox id that is not host-safe", () => {
    expect(() => buildPreviewUrl("evil.example.com", 8080)).toThrow(
      PreviewUrlError,
    )
    expect(() => buildPreviewUrl("id/../../x", 8080)).toThrow(PreviewUrlError)
    expect(() => buildPreviewUrl("a@b", 8080)).toThrow(PreviewUrlError)
  })
})
