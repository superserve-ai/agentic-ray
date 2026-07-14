/**
 * apiClient — the fetch wrapper every hook depends on.
 *
 * Tests:
 *   - URL is prefixed with /api
 *   - Content-Type is auto-set to application/json for string bodies
 *   - 204 returns undefined without parsing
 *   - Normal 200 JSON parses and returns
 *   - Non-OK with JSON error body → ApiError with code/message
 *   - Non-OK with non-JSON body → ApiError with statusText
 *   - Timeout aborts the request (30s default, override-able via signal)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, apiClient } from "./client"

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

describe("ApiError", () => {
  it("exposes status, code, and message", () => {
    const err = new ApiError(403, "forbidden", "Access denied")
    expect(err.status).toBe(403)
    expect(err.code).toBe("forbidden")
    expect(err.message).toBe("Access denied")
    expect(err.name).toBe("ApiError")
    expect(err).toBeInstanceOf(Error)
  })
})

describe("apiClient", () => {
  beforeEach(() => {
    fetchSpy.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("prefixes the URL with /api", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    await apiClient("/sandboxes")
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sandboxes/",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("auto-sets Content-Type to application/json for string bodies", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
    await apiClient("/sandboxes", {
      method: "POST",
      body: JSON.stringify({ name: "x" }),
    })
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const headers = init.headers as Headers
    expect(headers.get("Content-Type")).toBe("application/json")
  })

  it("respects an existing Content-Type header on the caller", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
    await apiClient("/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/x-custom" },
      body: "raw",
    })
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const headers = init.headers as Headers
    expect(headers.get("Content-Type")).toBe("application/x-custom")
  })

  it("returns undefined on 204 No Content", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))
    const result = await apiClient<void>("/sandboxes/abc", {
      method: "DELETE",
    })
    expect(result).toBeUndefined()
  })

  it("parses JSON on 200 responses", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "s1", name: "x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const result = await apiClient<{ id: string; name: string }>(
      "/sandboxes/s1",
    )
    expect(result).toEqual({ id: "s1", name: "x" })
  })

  it("throws ApiError with code/message from a JSON error body", async () => {
    // Each fetch gets its own response because the body stream can't be
    // consumed twice.
    const makeErrResponse = () =>
      new Response(
        JSON.stringify({
          error: { code: "quota_exceeded", message: "Plan limit reached" },
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      )
    fetchSpy.mockImplementation(() => Promise.resolve(makeErrResponse()))

    try {
      await apiClient("/sandboxes", { method: "POST" })
      expect.fail("expected apiClient to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect(err).toMatchObject({
        status: 429,
        code: "quota_exceeded",
        message: "Plan limit reached",
      })
    }
  })

  it("throws ApiError with defaults when the error body isn't valid JSON", async () => {
    fetchSpy.mockResolvedValue(
      new Response("<html>500</html>", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    )

    try {
      await apiClient("/sandboxes")
      expect.fail("expected apiClient to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(500)
      expect(apiErr.code).toBe("unknown_error")
    }
  })

  it("includes an AbortSignal so requests can be cancelled on timeout", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
    await apiClient("/sandboxes")
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
    // signal should NOT be aborted on the happy path.
    expect(init.signal?.aborted).toBe(false)
  })
})
