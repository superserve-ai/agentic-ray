import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ConflictError,
  NotFoundError,
  SandboxError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "../src/errors.js"
import { request, streamSSE } from "../src/http.js"

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  })
}

function emptyResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, { status, headers })
}

function installFetch(
  impl: (...args: unknown[]) => Promise<Response>,
): FetchMock {
  const mock = vi.fn(impl)
  vi.stubGlobal("fetch", mock)
  return mock
}

describe("http.request", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("returns parsed JSON on successful GET", async () => {
    installFetch(async () => jsonResponse({ hello: "world" }))
    const out = await request<{ hello: string }>({
      method: "GET",
      url: "https://example.com/x",
    })
    expect(out).toEqual({ hello: "world" })
  })

  it("returns undefined on 204", async () => {
    installFetch(async () => emptyResponse(204))
    const out = await request<void>({
      method: "DELETE",
      url: "https://example.com/x",
    })
    expect(out).toBeUndefined()
  })

  it("returns undefined when 2xx has an empty body (no JSON parse crash)", async () => {
    installFetch(async () => new Response("", { status: 200 }))
    const out = await request<void>({
      method: "GET",
      url: "https://example.com/x",
    })
    expect(out).toBeUndefined()
  })

  it("throws mapped error on 4xx", async () => {
    installFetch(async () =>
      jsonResponse(
        { error: { code: "bad_request", message: "nope" } },
        { status: 400 },
      ),
    )
    await expect(
      request({ method: "GET", url: "https://example.com/x" }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("throws ServerError on 5xx (non-retryable status)", async () => {
    installFetch(async () =>
      jsonResponse(
        { error: { code: "internal", message: "boom" } },
        { status: 500 },
      ),
    )
    await expect(
      request({ method: "GET", url: "https://example.com/x" }),
    ).rejects.toBeInstanceOf(ServerError)
  })

  it("retries GET on 503 up to 3 times, then throws", async () => {
    const mock = installFetch(async () =>
      jsonResponse(
        { error: { code: "unavailable", message: "try later" } },
        { status: 503 },
      ),
    )
    await expect(
      request({ method: "GET", url: "https://example.com/x" }),
    ).rejects.toBeInstanceOf(ServerError)
    expect(mock).toHaveBeenCalledTimes(3)
  })

  it("retries 429 with Retry-After: 0 and succeeds", async () => {
    let call = 0
    const mock = installFetch(async () => {
      call++
      if (call === 1) {
        return new Response("{}", {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      }
      return jsonResponse({ ok: true })
    })
    const out = await request<{ ok: boolean }>({
      method: "GET",
      url: "https://example.com/x",
    })
    expect(out.ok).toBe(true)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry POST on 503", async () => {
    const mock = installFetch(async () =>
      jsonResponse(
        { error: { code: "unavailable", message: "try later" } },
        { status: 503 },
      ),
    )
    await expect(
      request({
        method: "POST",
        url: "https://example.com/x",
        body: { a: 1 },
      }),
    ).rejects.toBeInstanceOf(ServerError)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("retries DELETE on 409 with retryConflict, then succeeds", async () => {
    let call = 0
    const mock = installFetch(async () => {
      call++
      if (call === 1) {
        return jsonResponse(
          { error: { code: "conflict", message: "mid-transition" } },
          { status: 409 },
        )
      }
      return emptyResponse(204)
    })
    const out = await request<void>({
      method: "DELETE",
      url: "https://example.com/sandboxes/abc",
      retryConflict: true,
    })
    expect(out).toBeUndefined()
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry 409 on DELETE without retryConflict", async () => {
    // A terminal 409 (e.g. deleting a template with active sandboxes) must fail
    // fast, not spin the conflict-retry budget.
    const mock = installFetch(async () =>
      jsonResponse(
        { error: { code: "conflict", message: "has active sandboxes" } },
        { status: 409 },
      ),
    )
    await expect(
      request({ method: "DELETE", url: "https://example.com/templates/abc" }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("retries GET on network error (TypeError)", async () => {
    let call = 0
    const mock = installFetch(async () => {
      call++
      if (call < 3) {
        throw new TypeError("fetch failed")
      }
      return jsonResponse({ ok: true })
    })
    const out = await request<{ ok: boolean }>({
      method: "GET",
      url: "https://example.com/x",
    })
    expect(out.ok).toBe(true)
    expect(mock).toHaveBeenCalledTimes(3)
  })

  it("propagates caller AbortSignal without throwing TimeoutError", async () => {
    const controller = new AbortController()
    installFetch(async (_input, init) => {
      const signal = (init as RequestInit).signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        })
      })
    })

    const p = request({
      method: "GET",
      url: "https://example.com/x",
      signal: controller.signal,
    })

    // Abort after a microtask to ensure fetch was invoked
    queueMicrotask(() => controller.abort())

    await expect(p).rejects.toSatisfy((err: unknown) => {
      return err instanceof SandboxError && !(err instanceof TimeoutError)
    })
  })

  it("throws TimeoutError when internal timeout fires", async () => {
    vi.useFakeTimers()
    installFetch(async (_input, init) => {
      const signal = (init as RequestInit).signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        })
      })
    })

    const p = request({
      method: "POST",
      url: "https://example.com/x",
      body: {},
      timeoutMs: 50,
    })
    // Attach catch right away to avoid unhandled rejection
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(100)
    await assertion
  })

  it("includes User-Agent header", async () => {
    const mock = installFetch(async () => jsonResponse({ ok: true }))
    await request({ method: "GET", url: "https://example.com/x" })

    const init = mock.mock.calls[0]?.[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers["User-Agent"]).toMatch(/^@superserve\/sdk\/\d+\.\d+\.\d+/)
  })

  it("serializes JSON body correctly", async () => {
    const mock = installFetch(async () => jsonResponse({ ok: true }))
    await request({
      method: "POST",
      url: "https://example.com/x",
      body: { hello: "world", n: 42 },
    })
    const init = mock.mock.calls[0]?.[1] as RequestInit
    expect(init.body).toBe(JSON.stringify({ hello: "world", n: 42 }))
    const headers = init.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it("user-supplied header overrides User-Agent", async () => {
    const mock = installFetch(async () => jsonResponse({ ok: true }))
    await request({
      method: "GET",
      url: "https://example.com/x",
      headers: { "User-Agent": "custom/1.0" },
    })
    const init = mock.mock.calls[0]?.[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers["User-Agent"]).toBe("custom/1.0")
  })

  it("maps 404 correctly on retryable GET (no retry on 4xx)", async () => {
    const mock = installFetch(async () =>
      jsonResponse(
        { error: { code: "not_found", message: "gone" } },
        { status: 404 },
      ),
    )
    await expect(
      request({ method: "GET", url: "https://example.com/x" }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe("streamSSE with GET", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses GET and omits body when method=GET", async () => {
    const sseLines = [
      'data: {"stream":"stdout","text":"hello","timestamp":"2026-01-01T00:00:00Z"}',
      "",
      'data: {"stream":"system","text":"done","timestamp":"2026-01-01T00:00:01Z","finished":true,"status":"ready"}',
      "",
    ].join("\n")

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseLines))
        controller.close()
      },
    })

    const mock = vi.fn(async () => new Response(stream, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const events: unknown[] = []
    await streamSSE({
      url: "https://api.example.com/templates/t-1/builds/b-1/logs",
      headers: { "X-API-Key": "k" },
      method: "GET",
      onEvent: (ev) => events.push(ev),
    })

    expect(mock).toHaveBeenCalledTimes(1)
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("GET")
    expect(init.body).toBeUndefined()
    expect(events.length).toBe(2)
  })
})
