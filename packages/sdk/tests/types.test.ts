import { describe, expect, it } from "vitest"

import {
  buildStepsToApi,
  toBuildLogEvent,
  toSandboxInfo,
  toTemplateBuildInfo,
  toTemplateInfo,
} from "../src/types.js"

describe("toSandboxInfo", () => {
  const valid = {
    id: "sbx-1",
    name: "my-sandbox",
    status: "active",
    vcpu_count: 2,
    memory_mib: 512,
    created_at: "2026-01-01T00:00:00.000Z",
    timeout_seconds: 600,
    network: { allow_out: ["1.1.1.1"], deny_out: ["2.2.2.2"] },
    metadata: { env: "prod" },
  }

  it("converts a valid response to SandboxInfo", () => {
    const info = toSandboxInfo(valid)
    expect(info.id).toBe("sbx-1")
    expect(info.name).toBe("my-sandbox")
    expect(info.status).toBe("active")
    expect(info.vcpuCount).toBe(2)
    expect(info.memoryMib).toBe(512)
    expect(info.createdAt).toBeInstanceOf(Date)
    expect(info.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    expect(info.timeoutSeconds).toBe(600)
    expect(info.network).toEqual({
      allowOut: ["1.1.1.1"],
      denyOut: ["2.2.2.2"],
    })
    expect(info.metadata).toEqual({ env: "prod" })
  })

  it("converts auto-delete fields", () => {
    const info = toSandboxInfo({
      ...valid,
      auto_delete_seconds: 3600,
      auto_delete_at: "2026-01-01T01:00:00.000Z",
    })
    expect(info.autoDeleteSeconds).toBe(3600)
    expect(info.autoDeleteAt).toBeInstanceOf(Date)
    expect(info.autoDeleteAt?.toISOString()).toBe("2026-01-01T01:00:00.000Z")
  })

  it("throws when id is missing", () => {
    expect(() => toSandboxInfo({ ...valid, id: undefined })).toThrow(
      /missing sandbox id/,
    )
  })

  it("throws when status is missing", () => {
    expect(() => toSandboxInfo({ ...valid, status: undefined })).toThrow(
      /missing sandbox status/,
    )
  })

  it("defaults optional fields when missing", () => {
    const info = toSandboxInfo({
      id: "sbx-1",
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    })
    expect(info.name).toBe("")
    expect(info.vcpuCount).toBe(0)
    expect(info.memoryMib).toBe(0)
    expect(info.timeoutSeconds).toBeUndefined()
    expect(info.autoDeleteSeconds).toBeUndefined()
    expect(info.autoDeleteAt).toBeUndefined()
    expect(info.network).toBeUndefined()
    expect(info.metadata).toEqual({})
  })

  it("throws when created_at is missing", () => {
    expect(() => toSandboxInfo({ id: "sbx-1", status: "active" })).toThrow(
      /missing created_at/,
    )
  })
})

describe("toTemplateInfo", () => {
  it("converts snake_case API to camelCase", () => {
    const info = toTemplateInfo({
      id: "t-1",
      team_id: "team-1",
      name: "my-env",
      status: "ready",
      vcpu: 2,
      memory_mib: 2048,
      disk_mib: 4096,
      size_bytes: 12345,
      created_at: "2026-01-01T00:00:00Z",
      built_at: "2026-01-01T00:01:00Z",
    })
    expect(info.id).toBe("t-1")
    expect(info.name).toBe("my-env")
    expect(info.status).toBe("ready")
    expect(info.vcpu).toBe(2)
    expect(info.memoryMib).toBe(2048)
    expect(info.diskMib).toBe(4096)
    expect(info.sizeBytes).toBe(12345)
    expect(info.createdAt).toBeInstanceOf(Date)
    expect(info.builtAt).toBeInstanceOf(Date)
  })

  it("handles optional fields absent", () => {
    const info = toTemplateInfo({
      id: "t-1",
      team_id: "team-1",
      name: "my-env",
      status: "building",
      vcpu: 1,
      memory_mib: 1024,
      disk_mib: 4096,
      created_at: "2026-01-01T00:00:00Z",
    })
    expect(info.sizeBytes).toBeUndefined()
    expect(info.builtAt).toBeUndefined()
    expect(info.errorMessage).toBeUndefined()
  })

  it("throws on missing id", () => {
    expect(() =>
      toTemplateInfo({
        name: "x",
        status: "ready",
        team_id: "t",
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(/missing template id/)
  })

  it("throws on missing name", () => {
    expect(() =>
      toTemplateInfo({
        id: "t-1",
        team_id: "team-1",
        status: "ready",
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(/missing template name/)
  })

  it("throws on missing status", () => {
    expect(() =>
      toTemplateInfo({
        id: "t-1",
        team_id: "team-1",
        name: "x",
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(/missing template status/)
  })

  it("throws on missing team_id", () => {
    expect(() =>
      toTemplateInfo({
        id: "t-1",
        name: "x",
        status: "ready",
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(/missing team_id/)
  })

  it("throws on missing created_at", () => {
    expect(() =>
      toTemplateInfo({
        id: "t-1",
        team_id: "team-1",
        name: "x",
        status: "ready",
      }),
    ).toThrow(/missing created_at/)
  })
})

describe("toTemplateBuildInfo", () => {
  it("converts snake_case API to camelCase", () => {
    const info = toTemplateBuildInfo({
      id: "b-1",
      template_id: "t-1",
      status: "ready",
      build_spec_hash: "hash123",
      started_at: "2026-01-01T00:00:00Z",
      finalized_at: "2026-01-01T00:01:00Z",
      created_at: "2026-01-01T00:00:00Z",
    })
    expect(info.id).toBe("b-1")
    expect(info.templateId).toBe("t-1")
    expect(info.status).toBe("ready")
    expect(info.buildSpecHash).toBe("hash123")
    expect(info.startedAt).toBeInstanceOf(Date)
  })

  it("handles optional fields absent", () => {
    const info = toTemplateBuildInfo({
      id: "b-1",
      template_id: "t-1",
      status: "pending",
      build_spec_hash: "h",
      created_at: "2026-01-01T00:00:00Z",
    })
    expect(info.startedAt).toBeUndefined()
    expect(info.finalizedAt).toBeUndefined()
    expect(info.errorMessage).toBeUndefined()
  })

  it("throws on missing id", () => {
    expect(() =>
      toTemplateBuildInfo({
        template_id: "t-1",
        status: "pending",
        build_spec_hash: "h",
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(/missing build id/)
  })

  it("throws on missing template_id", () => {
    expect(() =>
      toTemplateBuildInfo({
        id: "b-1",
        status: "pending",
        build_spec_hash: "h",
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(/missing template_id/)
  })

  it("throws on missing build_spec_hash", () => {
    expect(() =>
      toTemplateBuildInfo({
        id: "b-1",
        template_id: "t-1",
        status: "pending",
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(/missing build_spec_hash/)
  })
})

describe("toBuildLogEvent", () => {
  it("converts snake_case fields", () => {
    const ev = toBuildLogEvent({
      timestamp: "2026-01-01T00:00:00Z",
      stream: "stdout",
      text: "hello",
      finished: true,
      status: "ready",
    })
    expect(ev.stream).toBe("stdout")
    expect(ev.text).toBe("hello")
    expect(ev.finished).toBe(true)
    expect(ev.status).toBe("ready")
    expect(ev.timestamp).toBeInstanceOf(Date)
  })

  it("defaults text to empty string when absent", () => {
    const ev = toBuildLogEvent({
      timestamp: "2026-01-01T00:00:00Z",
      stream: "stdout",
    })
    expect(ev.text).toBe("")
  })

  it("throws on missing timestamp", () => {
    expect(() => toBuildLogEvent({ stream: "stdout", text: "x" })).toThrow(
      /missing timestamp/,
    )
  })

  it("throws on missing stream", () => {
    expect(() =>
      toBuildLogEvent({ timestamp: "2026-01-01T00:00:00Z", text: "x" }),
    ).toThrow(/missing stream/)
  })
})

describe("buildStepsToApi", () => {
  it("passes run step through unchanged", () => {
    const steps = buildStepsToApi([{ run: "echo hello" }])
    expect(steps).toEqual([{ run: "echo hello" }])
  })

  it("serialises env step with nested key/value", () => {
    const steps = buildStepsToApi([{ env: { key: "DEBUG", value: "1" } }])
    expect(steps).toEqual([{ env: { key: "DEBUG", value: "1" } }])
  })

  it("leaves sudo absent when unset on user step", () => {
    const steps = buildStepsToApi([{ user: { name: "appuser" } }])
    expect(steps).toEqual([{ user: { name: "appuser" } }])
  })

  it("preserves sudo true when set", () => {
    const steps = buildStepsToApi([{ user: { name: "appuser", sudo: true } }])
    expect(steps).toEqual([{ user: { name: "appuser", sudo: true } }])
  })
})
