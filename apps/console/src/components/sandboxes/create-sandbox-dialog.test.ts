/**
 * create-sandbox-dialog — payload mapping.
 *
 * Tests the pure builder that converts form state to a
 * `CreateSandboxRequest`. The dialog itself is heavy (BaseUI Dialog,
 * Select, Field, motion animations, Highlighted code), so we test the
 * logic in isolation rather than driving the UI.
 */

import { describe, expect, it } from "vitest"

import { buildCreateSandboxRequest } from "./create-sandbox-dialog"

const emptyState = {
  name: "",
  timeout: "",
  autoDelete: "",
  allowRules: [] as string[],
  denyRules: [] as string[],
  secretEntries: [] as { key: string; secret: string }[],
  envEntries: [] as { key: string; value: string }[],
  metadataEntries: [] as { key: string; value: string }[],
}

describe("buildCreateSandboxRequest", () => {
  it("trims the name", () => {
    const req = buildCreateSandboxRequest({ ...emptyState, name: "  hi  " })
    expect(req.name).toBe("hi")
  })

  it("omits optional fields when form is minimal", () => {
    const req = buildCreateSandboxRequest({ ...emptyState, name: "x" })
    expect(req).toEqual({ name: "x" })
    expect(req.timeout_seconds).toBeUndefined()
    expect(req.network).toBeUndefined()
    expect(req.env_vars).toBeUndefined()
    expect(req.metadata).toBeUndefined()
  })

  it("includes timeout_seconds as a number when present", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      timeout: "300",
    })
    expect(req.timeout_seconds).toBe(300)
  })

  it("includes auto_delete_seconds as a number when present", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      autoDelete: "3600",
    })
    expect(req.auto_delete_seconds).toBe(3600)
  })

  it("accepts auto_delete_seconds of 0 (delete on pause)", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      autoDelete: "0",
    })
    expect(req.auto_delete_seconds).toBe(0)
  })

  it("throws on a non-finite window ('1e309' → Infinity → null)", () => {
    expect(() =>
      buildCreateSandboxRequest({
        ...emptyState,
        name: "x",
        autoDelete: "1e309",
      }),
    ).toThrow(/whole number/)
  })

  it("throws on a fractional window", () => {
    expect(() =>
      buildCreateSandboxRequest({
        ...emptyState,
        name: "x",
        autoDelete: "1.5",
      }),
    ).toThrow(/whole number/)
  })

  it("throws on an out-of-range window", () => {
    expect(() =>
      buildCreateSandboxRequest({
        ...emptyState,
        name: "x",
        autoDelete: "2592001",
      }),
    ).toThrow(/whole number/)
  })

  it("throws when timeout is below its minimum of 1", () => {
    expect(() =>
      buildCreateSandboxRequest({ ...emptyState, name: "x", timeout: "0" }),
    ).toThrow(/whole number/)
  })

  it("omits network when all rules are empty strings", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      allowRules: ["", "  "],
      denyRules: [""],
    })
    expect(req.network).toBeUndefined()
  })

  it("includes network.allow_out only (not deny_out) when no deny rules", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      allowRules: ["api.example.com", "*.github.com"],
    })
    expect(req.network).toEqual({
      allow_out: ["api.example.com", "*.github.com"],
    })
    expect(req.network?.deny_out).toBeUndefined()
  })

  it("includes network.deny_out only (not allow_out) when no allow rules", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      denyRules: ["malicious.test"],
    })
    expect(req.network).toEqual({ deny_out: ["malicious.test"] })
  })

  it("trims and drops blank network rules", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      allowRules: [" api.example.com ", "", "   "],
    })
    expect(req.network?.allow_out).toEqual(["api.example.com"])
  })

  it("omits env_vars when no entry has a key", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      envEntries: [
        { key: "", value: "v" },
        { key: "   ", value: "" },
      ],
    })
    expect(req.env_vars).toBeUndefined()
  })

  it("includes env_vars with trimmed keys/values", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      envEntries: [
        { key: " API_KEY ", value: " abc " },
        { key: "DEBUG", value: "" },
      ],
    })
    expect(req.env_vars).toEqual({ API_KEY: "abc", DEBUG: "" })
  })

  it("omits secrets when no entry is complete", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      secretEntries: [
        { key: "", secret: "openai_api_key" },
        { key: "OPENAI_API_KEY", secret: "" },
      ],
    })
    expect(req.secrets).toBeUndefined()
  })

  it("includes secrets with trimmed env keys", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      secretEntries: [{ key: " OPENAI_API_KEY ", secret: "openai_api_key" }],
    })
    expect(req.secrets).toEqual({ OPENAI_API_KEY: "openai_api_key" })
  })

  it("includes metadata with trimmed keys/values", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      metadataEntries: [
        { key: "env", value: "prod" },
        { key: "owner ", value: " team-a " },
      ],
    })
    expect(req.metadata).toEqual({ env: "prod", owner: "team-a" })
  })

  it("builds a full request with everything set", () => {
    const req = buildCreateSandboxRequest({
      name: "full",
      timeout: "600",
      autoDelete: "3600",
      allowRules: ["api.example.com"],
      denyRules: ["malicious.test"],
      secretEntries: [{ key: "GITHUB_TOKEN", secret: "github_pat" }],
      envEntries: [{ key: "API_KEY", value: "abc" }],
      metadataEntries: [{ key: "env", value: "prod" }],
    })
    expect(req).toEqual({
      name: "full",
      timeout_seconds: 600,
      auto_delete_seconds: 3600,
      network: {
        allow_out: ["api.example.com"],
        deny_out: ["malicious.test"],
      },
      secrets: { GITHUB_TOKEN: "github_pat" },
      env_vars: { API_KEY: "abc" },
      metadata: { env: "prod" },
    })
  })
})
