import { afterEach, describe, expect, it, vi } from "vitest"

import { createSdkClient } from "../src/client.js"
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
    expect(() => buildPreviewUrl("id", 80)).toThrow(PreviewUrlError)
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

describe("SDK client preview publication", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("publishes a strict public port and returns its clean URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ port: 8080, token_version: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            preview_access: "public",
            ports: [{ port: 8080, token_version: 1 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    const client = createSdkClient({
      apiKey: "ss_test",
      baseUrl: "https://api.superserve.ai",
    })

    await expect(client.previewUrl("sbx-1", 8080, 60)).resolves.toEqual({
      url: "https://8080-sbx-1.sandbox.superserve.ai",
      previewAccess: "public",
      authenticated: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, publishInit] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(publishInit.method).toBe("POST")
    expect(JSON.parse(publishInit.body as string)).toEqual({ port: 8080 })
  })

  it("mints an expiring signed link for a private port", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ port: 8080, token_version: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            preview_access: "private",
            ports: [{ port: 8080, token_version: 1 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "private-secret",
            query_param: "superserve_preview_token",
            preview_access: "private",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    const client = createSdkClient({
      apiKey: "ss_test",
      baseUrl: "https://api.superserve.ai",
    })

    const link = await client.previewUrl("sbx-1", 8080, 90)
    expect(link).toEqual({
      url: "https://8080-sbx-1.sandbox.superserve.ai/?superserve_preview_token=private-secret",
      previewAccess: "private",
      authenticated: true,
    })
    const [, tokenInit] = fetchMock.mock.calls[2] as [URL, RequestInit]
    expect(JSON.parse(tokenInit.body as string)).toEqual({
      expires_in_seconds: 90,
    })
  })
})
