import { afterEach, describe, expect, it, vi } from "vitest"

import { attachSandboxSecret, detachSandboxSecret } from "./sandboxes"

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
