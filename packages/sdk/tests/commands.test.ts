import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Commands,
  MAX_EXEC_RESPONSE_BYTES,
  type CommandsDeps,
} from "../src/commands.js"
import {
  AuthenticationError,
  SandboxError,
  ValidationError,
} from "../src/errors.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

const sandboxId = "sbx-1"
const sandboxHost = "sandbox.example.com"
const dataPlaneUrl = `https://boxd-${sandboxId}.${sandboxHost}`

function makeDeps(overrides: Partial<CommandsDeps> = {}): CommandsDeps {
  let token = "tok-initial"
  return {
    sandboxId,
    sandboxHost,
    getAccessToken: () => token,
    refreshActivate: async () => {
      token = "tok-refreshed"
      return token
    },
    ...overrides,
  }
}

describe("Commands.run (sync) output cap", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function streamedResponse(body: Uint8Array): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  // The data plane is untrusted: boxd buffers the command's full stdout/stderr
  // in the VM and returns it in one JSON body, and neither the proxy nor fetch
  // caps it — so a command can stream back as much output as the sandbox has
  // RAM. The sync read must abort at the cap instead of buffering it all.
  it("aborts a /exec body larger than MAX_EXEC_RESPONSE_BYTES", async () => {
    const oversized = new Uint8Array(MAX_EXEC_RESPONSE_BYTES + 64)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse(oversized)),
    )

    const commands = new Commands(makeDeps())
    await expect(commands.run("cat /dev/zero")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it("honors a smaller maxOutputBytes override", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ stdout: "x".repeat(4096), stderr: "", exit_code: 0 }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse(body)),
    )

    const commands = new Commands(makeDeps())
    await expect(
      commands.run("echo big", { maxOutputBytes: 512 }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("returns output unchanged when under the cap", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ stdout: "hi\n", stderr: "", exit_code: 0 }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse(body)),
    )

    const commands = new Commands(makeDeps())
    const result = await commands.run("echo hi", { maxOutputBytes: 1024 })
    expect(result).toEqual({
      stdout: "hi\n",
      stderr: "",
      exitCode: 0,
      truncated: false,
    })
  })
})

describe("Commands.run (sync)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("hits the data-plane /exec with X-Access-Token", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ stdout: "hello\n", stderr: "warn\n", exit_code: 0 }),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(makeDeps())
    const result = await commands.run("echo hello")

    expect(result).toEqual({
      stdout: "hello\n",
      stderr: "warn\n",
      exitCode: 0,
      truncated: false,
    })
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${dataPlaneUrl}/exec`)
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["X-Access-Token"]).toBe(
      "tok-initial",
    )
    expect(
      (init.headers as Record<string, string>)["X-API-Key"],
    ).toBeUndefined()
  })

  it("surfaces the server's truncated flag", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({
        stdout: "partial",
        stderr: "",
        exit_code: 0,
        truncated: true,
      }),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(makeDeps())
    const result = await commands.run("yes")

    expect(result.truncated).toBe(true)
    expect(result.exitCode).toBe(0)
  })

  it("converts timeoutMs to timeout_s (ceiled)", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ stdout: "", stderr: "", exit_code: 0 }),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(makeDeps())
    await commands.run("sleep 1", { timeoutMs: 2500 })

    const init = mock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body.timeout_s).toBe(3)
  })

  it("refreshes token + retries on AuthenticationError, then succeeds", async () => {
    let refreshCalled = 0
    const deps = makeDeps({
      refreshActivate: async () => {
        refreshCalled += 1
        return "tok-refreshed"
      },
    })

    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "auth_failed" } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "ok\n", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(deps)
    const result = await commands.run("echo")

    expect(result.stdout).toBe("ok\n")
    expect(refreshCalled).toBe(1)
    expect(mock).toHaveBeenCalledTimes(2)
    const [, secondInit] = mock.mock.calls[1] as [string, RequestInit]
    expect(
      (secondInit.headers as Record<string, string>)["X-Access-Token"],
    ).toBe("tok-refreshed")
  })

  it("does NOT retry on non-auth errors (e.g. 500)", async () => {
    const deps = makeDeps()
    const mock = vi.fn(async () =>
      jsonResponse({ error: { code: "server_error" } }, 500),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(deps)
    await expect(commands.run("echo")).rejects.toBeInstanceOf(SandboxError)
  })

  it("resumes + retries on 503 (paused sandbox), then succeeds", async () => {
    let refreshCalled = 0
    const deps = makeDeps({
      refreshActivate: async () => {
        refreshCalled += 1
        return "tok-refreshed"
      },
    })

    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "sandbox_paused", message: "sandbox is paused" } },
          503,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "ok\n", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    const result = await new Commands(deps).run("echo")

    expect(result.stdout).toBe("ok\n")
    expect(refreshCalled).toBe(1)
    expect(mock).toHaveBeenCalledTimes(2)
    const [, secondInit] = mock.mock.calls[1] as [string, RequestInit]
    expect(
      (secondInit.headers as Record<string, string>)["X-Access-Token"],
    ).toBe("tok-refreshed")
  })

  it("does NOT resume on a genuine 500 (only 503 means paused)", async () => {
    let refreshCalled = 0
    const deps = makeDeps({
      refreshActivate: async () => {
        refreshCalled += 1
        return "tok-refreshed"
      },
    })
    const mock = vi.fn(async () =>
      jsonResponse({ error: { code: "server_error" } }, 500),
    )
    vi.stubGlobal("fetch", mock)

    await expect(new Commands(deps).run("echo")).rejects.toBeInstanceOf(
      SandboxError,
    )
    expect(refreshCalled).toBe(0)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("propagates AuthenticationError if refresh also fails", async () => {
    const deps = makeDeps({
      refreshActivate: async () => "tok-refreshed",
    })
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { code: "auth_failed" } }, 401))
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(deps)
    await expect(commands.run("echo")).rejects.toBeInstanceOf(
      AuthenticationError,
    )
  })
})

describe("Commands.run (streaming)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("hits data-plane /exec/stream and aggregates stdout chunks", async () => {
    const mock = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ stdout: "hi " })}\n`,
        `data: ${JSON.stringify({ stdout: "there" })}\n`,
        `data: ${JSON.stringify({ finished: true, exit_code: 0 })}\n`,
      ]),
    )
    vi.stubGlobal("fetch", mock)

    const received: string[] = []
    const commands = new Commands(makeDeps())
    const result = await commands.run("echo", {
      onStdout: (d) => received.push(d),
    })

    expect(received).toEqual(["hi ", "there"])
    expect(result.stdout).toBe("hi there")
    expect(result.exitCode).toBe(0)
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe(`${dataPlaneUrl}/exec/stream`)
  })

  it("throws if stream ends without finished event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([`data: ${JSON.stringify({ stdout: "partial" })}\n`]),
      ),
    )

    const commands = new Commands(makeDeps())
    await expect(
      commands.run("echo", { onStdout: () => {} }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SandboxError && /finished event/.test(err.message),
    )
  })

  it("appends error field from finished event to stderr", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          `data: ${JSON.stringify({ stderr: "warn\n" })}\n`,
          `data: ${JSON.stringify({ finished: true, exit_code: 1, error: "crashed" })}\n`,
        ]),
      ),
    )

    const commands = new Commands(makeDeps())
    const result = await commands.run("bad", { onStderr: () => {} })
    expect(result.stderr).toBe("warn\ncrashed")
    expect(result.exitCode).toBe(1)
  })

  it("streaming retry on 401 doesn't double-emit callbacks", async () => {
    let refreshCalls = 0
    const deps = makeDeps({
      refreshActivate: async () => {
        refreshCalls += 1
        return "tok-refreshed"
      },
    })
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "auth_failed" } }, 401),
      )
      .mockResolvedValueOnce(
        sseResponse([
          `data: ${JSON.stringify({ stdout: "one" })}\n`,
          `data: ${JSON.stringify({ finished: true, exit_code: 0 })}\n`,
        ]),
      )
    vi.stubGlobal("fetch", mock)

    const received: string[] = []
    const commands = new Commands(deps)
    const result = await commands.run("echo", {
      onStdout: (d) => received.push(d),
    })

    // Callbacks fire exactly once — the 401 attempt never invoked onStdout
    expect(received).toEqual(["one"])
    expect(result.stdout).toBe("one")
    expect(result.exitCode).toBe(0)
    expect(refreshCalls).toBe(1)
  })
})

describe("Commands.run (shared-host routing)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses shared host + X-Superserve-Sandbox-Id when sandboxHost is supported", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "hi\n", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(
      makeDeps({ sandboxHost: "sandbox.superserve.ai" }),
    )
    await commands.run("echo hi")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://sandbox.superserve.ai/exec")
    const headers = init.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBe(sandboxId)
    expect(headers["X-Access-Token"]).toBe("tok-initial")
  })

  it("falls back to per-sandbox subdomain on unsupported host", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(
      makeDeps({ sandboxHost: "self-hosted.example.org" }),
    )
    await commands.run("echo")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://boxd-${sandboxId}.self-hosted.example.org/exec`)
    const headers = init.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBeUndefined()
  })

  it("streaming carries X-Superserve-Sandbox-Id on shared host", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          `data: ${JSON.stringify({ stdout: "x" })}\n`,
          `data: ${JSON.stringify({ finished: true, exit_code: 0 })}\n`,
        ]),
      )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(
      makeDeps({ sandboxHost: "sandbox.superserve.ai" }),
    )
    await commands.run("echo", { onStdout: () => {} })

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://sandbox.superserve.ai/exec/stream")
    const headers = init.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBe(sandboxId)
  })

  it("preserves X-Superserve-Sandbox-Id after 401 retry on shared host", async () => {
    const deps = makeDeps({
      sandboxHost: "sandbox.superserve.ai",
      refreshActivate: async () => "tok-refreshed",
    })
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "auth_failed" } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "ok\n", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    await new Commands(deps).run("echo")

    const [, secondInit] = mock.mock.calls[1] as [string, RequestInit]
    const headers = secondInit.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBe(sandboxId)
    expect(headers["X-Access-Token"]).toBe("tok-refreshed")
  })
})
