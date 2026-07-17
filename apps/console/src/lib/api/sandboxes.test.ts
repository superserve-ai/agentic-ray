import { afterEach, describe, expect, it, vi } from "vitest"

import { redactPreviewToken } from "@/lib/preview-token-redaction"

import {
  attachSandboxSecret,
  detachSandboxSecret,
  listSandboxPreviewPorts,
  mintSandboxPreviewToken,
  publishSandboxPreviewPort,
  rotateSandboxPreviewToken,
  unpublishSandboxPreviewPort,
} from "./sandboxes"

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

describe("sandbox secret bindings", () => {
  afterEach(() => {
    fetchSpy.mockReset()
  })

  it("attachSandboxSecret POSTs the binding to /sandboxes/{id}/secrets", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          env_key: "ANTHROPIC_API_KEY",
          secret_name: "anthropic-prod",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    )
    await attachSandboxSecret("sbx-1", "ANTHROPIC_API_KEY", "anthropic-prod")

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/sandboxes/sbx-1/secrets/")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      env_key: "ANTHROPIC_API_KEY",
      secret_name: "anthropic-prod",
    })
  })

  it("detachSandboxSecret DELETEs and url-encodes the env key", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))
    await detachSandboxSecret("sbx-1", "A/B")

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/sandboxes/sbx-1/secrets/A%2FB/")
    expect(init.method).toBe("DELETE")
  })
})

describe("sandbox preview ports", () => {
  afterEach(() => {
    fetchSpy.mockReset()
  })

  it("lists the server-backed publication policy", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          preview_access: "private",
          ports: [{ port: 3000, token_version: 2 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    await expect(listSandboxPreviewPorts("sbx-1")).resolves.toEqual({
      preview_access: "private",
      ports: [{ port: 3000, token_version: 2 }],
    })
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "/api/sandboxes/sbx-1/preview-ports/",
    )
  })

  it("publishes and unpublishes a port", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ port: 3000, token_version: 1 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await publishSandboxPreviewPort("sbx-1", 3000)
    await unpublishSandboxPreviewPort("sbx-1", 3000)

    const [, publishInit] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(publishInit.method).toBe("POST")
    expect(JSON.parse(publishInit.body as string)).toEqual({ port: 3000 })
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      "/api/sandboxes/sbx-1/preview-ports/3000/",
    )
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" })
  })

  it("mints expiring credentials and rotates one port", async () => {
    const credential = {
      token: "secret",
      port: 3000,
      header: "X-Superserve-Preview-Token",
      query_param: "mint_preview_credential",
      token_version: 2,
      preview_access: "private",
    }
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(credential), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...credential,
            query_param: "rotated_preview_credential",
            token_version: 3,
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )

    await mintSandboxPreviewToken("sbx-1", 3000, 60)
    await rotateSandboxPreviewToken("sbx-1", 3000)

    const [, mintInit] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(mintInit.body as string)).toEqual({
      expires_in_seconds: 60,
    })
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      "/api/sandboxes/sbx-1/preview-ports/3000/token/rotate/",
    )
    expect(
      redactPreviewToken({
        name: "/preview?rotated_preview_credential=secret",
        duration: 0,
        entryType: "resource",
        startTime: 0,
      }).name,
    ).toBe("/preview?rotated_preview_credential=redacted")
  })
})
