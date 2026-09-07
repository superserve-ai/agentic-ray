import { afterEach, describe, expect, it, vi } from "vitest"

import { Sandbox } from "../src/Sandbox.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const baseSandbox = {
  id: "sb-1",
  name: "agent-1",
  status: "active",
  vcpu_count: 1,
  memory_mib: 1024,
  access_token: "tok-1",
  created_at: "2026-01-01T00:00:00Z",
}

const commonOpts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.superserve.ai",
}

async function createSandbox(
  extra: Record<string, unknown> = {},
): Promise<{ sandbox: Sandbox; body: Record<string, unknown> }> {
  const mock = vi.fn(async () => jsonResponse(baseSandbox))
  vi.stubGlobal("fetch", mock)
  const sandbox = await Sandbox.create({
    ...commonOpts,
    name: "agent-1",
    ...extra,
  })
  // Skip the data-plane pre-warm ping; find the create POST.
  const createCall = mock.mock.calls.find(([url]) =>
    String(url).endsWith("/sandboxes"),
  ) as [string, RequestInit]
  const body = JSON.parse(createCall[1].body as string)
  vi.unstubAllGlobals()
  return { sandbox, body }
}

describe("Sandbox.create with secrets", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("includes the secrets map in the request body", async () => {
    const { body } = await createSandbox({
      secrets: { ANTHROPIC_API_KEY: "anthropic-prod" },
    })
    expect(body.secrets).toEqual({ ANTHROPIC_API_KEY: "anthropic-prod" })
  })

  it("omits secrets when not provided", async () => {
    const { body } = await createSandbox()
    expect(body.secrets).toBeUndefined()
  })

  it("surfaces bound secrets from the create response", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({
        ...baseSandbox,
        secrets: [
          { env_key: "ANTHROPIC_API_KEY", secret_name: "anthropic-prod" },
          { env_key: "OLD_KEY", secret_name: "gone", revoked: true },
        ],
      }),
    )
    vi.stubGlobal("fetch", mock)
    const sandbox = await Sandbox.create({
      ...commonOpts,
      name: "agent-1",
      secrets: { ANTHROPIC_API_KEY: "anthropic-prod" },
    })
    expect(sandbox.secrets).toEqual([
      {
        envKey: "ANTHROPIC_API_KEY",
        secretName: "anthropic-prod",
        revoked: undefined,
      },
      { envKey: "OLD_KEY", secretName: "gone", revoked: true },
    ])
  })
})

describe("sandbox.getNetworkLog", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("maps the enveloped page and parses both row kinds", async () => {
    const { sandbox } = await createSandbox()

    const mock = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            kind: "connection",
            id: 2,
            ts: "2026-01-01T00:01:00Z",
            host: "example.com",
            dst_ip: "1.2.3.4",
            dst_port: 443,
            verdict: "allowed",
            match_rule: "default",
            bytes_sent: 100,
            bytes_recv: 200,
          },
          {
            kind: "request",
            id: 1,
            ts: "2026-01-01T00:00:30Z",
            host: "api.anthropic.com",
            method: "POST",
            path: "/v1/messages",
            status: 200,
            secret_id: "sec-1",
          },
        ],
        next_cursor: "2026-01-01T00:00:30Z",
        has_more: true,
      }),
    )
    vi.stubGlobal("fetch", mock)

    const page = await sandbox.getNetworkLog({
      limit: 2,
      verdict: "allowed",
      since: "2026-01-01T00:00:00Z",
    })

    const url = mock.mock.calls[0][0] as string
    expect(url).toContain("/sandboxes/sb-1/network?")
    expect(url).toContain("limit=2")
    expect(url).toContain("verdict=allowed")
    expect(url).toContain("since=2026-01-01T00%3A00%3A00Z")

    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe("2026-01-01T00:00:30Z")
    expect(page.events).toHaveLength(2)

    const conn = page.events[0]
    expect(conn.kind).toBe("connection")
    expect(conn.verdict).toBe("allowed")
    expect(conn.dstIp).toBe("1.2.3.4")
    expect(conn.bytesRecv).toBe(200)
    expect(conn.ts).toBeInstanceOf(Date)

    const req = page.events[1]
    expect(req.kind).toBe("request")
    expect(req.method).toBe("POST")
    expect(req.secretId).toBe("sec-1")
  })

  it("sends no query string when no options are given", async () => {
    const { sandbox } = await createSandbox()
    const mock = vi.fn(async () =>
      jsonResponse({ data: [], next_cursor: null, has_more: false }),
    )
    vi.stubGlobal("fetch", mock)

    const page = await sandbox.getNetworkLog()
    expect(mock.mock.calls[0][0]).toBe(
      "https://api.superserve.ai/sandboxes/sb-1/network",
    )
    expect(page.events).toEqual([])
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeUndefined()
  })
})
