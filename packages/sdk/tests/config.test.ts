import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  dataPlaneTarget,
  MAX_PREVIEW_PORT,
  MIN_PREVIEW_PORT,
  previewUrl,
  resolveConfig,
} from "../src/config.js"
import { AuthenticationError, ValidationError } from "../src/errors.js"

describe("resolveConfig", () => {
  let savedApiKey: string | undefined
  let savedBaseUrl: string | undefined

  beforeEach(() => {
    savedApiKey = process.env.SUPERSERVE_API_KEY
    savedBaseUrl = process.env.SUPERSERVE_BASE_URL
    delete process.env.SUPERSERVE_API_KEY
    delete process.env.SUPERSERVE_BASE_URL
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    if (savedApiKey !== undefined) process.env.SUPERSERVE_API_KEY = savedApiKey
    else delete process.env.SUPERSERVE_API_KEY
    if (savedBaseUrl !== undefined)
      process.env.SUPERSERVE_BASE_URL = savedBaseUrl
    else delete process.env.SUPERSERVE_BASE_URL
  })

  it("uses explicit apiKey over env var", () => {
    vi.stubEnv("SUPERSERVE_API_KEY", "env-key")
    const cfg = resolveConfig({ apiKey: "explicit" })
    expect(cfg.apiKey).toBe("explicit")
  })

  it("falls back to SUPERSERVE_API_KEY env var", () => {
    vi.stubEnv("SUPERSERVE_API_KEY", "env-key")
    const cfg = resolveConfig()
    expect(cfg.apiKey).toBe("env-key")
  })

  it("throws AuthenticationError when both are missing", () => {
    expect(() => resolveConfig()).toThrow(AuthenticationError)
  })

  it("uses explicit baseUrl over env var", () => {
    vi.stubEnv("SUPERSERVE_BASE_URL", "https://env.example.com")
    const cfg = resolveConfig({
      apiKey: "k",
      baseUrl: "https://explicit.example.com",
    })
    expect(cfg.baseUrl).toBe("https://explicit.example.com")
  })

  it("falls back to SUPERSERVE_BASE_URL env var", () => {
    vi.stubEnv("SUPERSERVE_BASE_URL", "https://env.example.com")
    const cfg = resolveConfig({ apiKey: "k" })
    expect(cfg.baseUrl).toBe("https://env.example.com")
  })

  it("defaults baseUrl to api.superserve.ai", () => {
    const cfg = resolveConfig({ apiKey: "k" })
    expect(cfg.baseUrl).toBe("https://api.superserve.ai")
  })

  it("derives sandboxHost for production", () => {
    const cfg = resolveConfig({
      apiKey: "k",
      baseUrl: "https://api.superserve.ai",
    })
    expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
  })

  it("derives sandboxHost for staging", () => {
    const cfg = resolveConfig({
      apiKey: "k",
      baseUrl: "https://api-staging.superserve.ai",
    })
    expect(cfg.sandboxHost).toBe("staging-sandbox.superserve.ai")
  })

  it("derives sandboxHost falls back to default for unknown URL", () => {
    const cfg = resolveConfig({
      apiKey: "k",
      baseUrl: "https://custom.example.com",
    })
    expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
  })

  it("derives endpoints from a known region key", () => {
    const cfg = resolveConfig({ apiKey: "ss_live_use_abc123" })
    expect(cfg.baseUrl).toBe("https://api.superserve.ai")
    expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
  })

  it("falls back to defaults for an unknown region", () => {
    // `usw` won't enter the known-regions map until its DNS is live.
    const cfg = resolveConfig({ apiKey: "ss_live_usw_abc123" })
    expect(cfg.baseUrl).toBe("https://api.superserve.ai")
    expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
  })

  it("falls back to defaults for legacy keys", () => {
    const cfg = resolveConfig({ apiKey: "ss_live_a1B2c3D4" })
    expect(cfg.baseUrl).toBe("https://api.superserve.ai")
    expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
  })

  it("falls back to defaults for a legacy key whose `_` mimics a region", () => {
    // Legacy base64url random parts may contain `_`, so this parses as
    // region "abc123" — not in the map, so defaults win, which is correct
    // for all legacy keys (they are all us-east).
    const cfg = resolveConfig({ apiKey: "ss_live_abc123_def456" })
    expect(cfg.baseUrl).toBe("https://api.superserve.ai")
    expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
  })

  it("never resolves a region from prototype members or weird keys", () => {
    for (const apiKey of [
      "ss_live_constructor_x",
      "ss_live_USE_abc", // uppercase is not a region token
      "ss_live_us-e_abc", // non-alphanumeric
      `ss_live_${"a".repeat(18)}_rest`, // too long
      "ss_live_use_", // nothing after the region
      "ss_live__abc", // empty region
      "ss_live_",
      "not a key",
    ]) {
      const cfg = resolveConfig({ apiKey })
      expect(cfg.baseUrl).toBe("https://api.superserve.ai")
      expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
    }
  })

  it("uses explicit baseUrl over region derivation", () => {
    const cfg = resolveConfig({
      apiKey: "ss_live_use_abc123",
      baseUrl: "https://explicit.example.com",
    })
    expect(cfg.baseUrl).toBe("https://explicit.example.com")
    expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
  })

  it("uses SUPERSERVE_BASE_URL env var over region derivation", () => {
    vi.stubEnv("SUPERSERVE_BASE_URL", "https://env.example.com")
    const cfg = resolveConfig({ apiKey: "ss_live_use_abc123" })
    expect(cfg.baseUrl).toBe("https://env.example.com")
  })
})

describe("dataPlaneTarget", () => {
  it("uses shared host + routing header on supported prod host", () => {
    const target = dataPlaneTarget("abc-123", "sandbox.superserve.ai")
    expect(target.url).toBe("https://sandbox.superserve.ai")
    expect(target.headers["X-Superserve-Sandbox-Id"]).toBe("abc-123")
  })

  it("uses shared host + routing header on supported staging host", () => {
    const target = dataPlaneTarget("xyz", "staging-sandbox.superserve.ai")
    expect(target.url).toBe("https://staging-sandbox.superserve.ai")
    expect(target.headers["X-Superserve-Sandbox-Id"]).toBe("xyz")
  })

  it("falls back to per-sandbox subdomain on unsupported host", () => {
    const target = dataPlaneTarget("abc", "self-hosted.example.org")
    expect(target.url).toBe("https://boxd-abc.self-hosted.example.org")
    expect(target.headers).toEqual({})
  })

  it("matches supported hosts case-insensitively (RFC 4343)", () => {
    const target = dataPlaneTarget("abc", "Sandbox.SuperServe.AI")
    expect(target.url).toBe("https://sandbox.superserve.ai")
    expect(target.headers["X-Superserve-Sandbox-Id"]).toBe("abc")
  })
})

describe("previewUrl", () => {
  // Drift guard: the console (apps/console/src/hooks/use-preview-ports.ts) and
  // the Python SDK mirror these bounds. Keep all three in sync — this literal
  // pin makes one-sided drift fail CI.
  it("pins the port range to the edge-proxy contract", () => {
    expect(MIN_PREVIEW_PORT).toBe(1024)
    expect(MAX_PREVIEW_PORT).toBe(65535)
  })

  it("builds the per-sandbox subdomain URL for a port", () => {
    expect(previewUrl("abc-123", "sandbox.superserve.ai", 3000)).toBe(
      "https://3000-abc-123.sandbox.superserve.ai",
    )
  })

  it("uses the subdomain form even on shared hosts", () => {
    // A browser opening the URL can't send the routing header, so preview
    // URLs never use the shared-host origin.
    expect(previewUrl("xyz", "staging-sandbox.superserve.ai", 8080)).toBe(
      "https://8080-xyz.staging-sandbox.superserve.ai",
    )
  })

  it("accepts the boundary ports 1024 and 65535", () => {
    expect(previewUrl("a", "h", 1024)).toBe("https://1024-a.h")
    expect(previewUrl("a", "h", 65535)).toBe("https://65535-a.h")
  })

  it("throws ValidationError for privileged ports (< 1024)", () => {
    expect(() => previewUrl("a", "h", 80)).toThrow(ValidationError)
    expect(() => previewUrl("a", "h", 0)).toThrow(ValidationError)
  })

  it("throws ValidationError for out-of-range ports (> 65535)", () => {
    expect(() => previewUrl("a", "h", 70000)).toThrow(ValidationError)
  })

  it("throws ValidationError for non-integer ports", () => {
    expect(() => previewUrl("a", "h", 3000.5)).toThrow(ValidationError)
    expect(() => previewUrl("a", "h", Number.NaN)).toThrow(ValidationError)
  })
})
