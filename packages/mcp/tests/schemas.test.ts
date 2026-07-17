import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createFakeClient } from "./fake-client.js"
import { type ConnectedClient, connect } from "./harness.js"

const EXPECTED_TOOLS = [
  "sandbox_create",
  "sandbox_update",
  "sandbox_template_list",
  "sandbox_template_create",
  "sandbox_list",
  "sandbox_info",
  "sandbox_exec",
  "sandbox_files_read",
  "sandbox_files_write",
  "sandbox_files_list",
  "sandbox_files_download_dir",
  "sandbox_pause",
  "sandbox_resume",
  "sandbox_kill",
  "sandbox_preview_url",
  "sandbox_network_log",
  "secret_list",
  "sandbox_attach_secret",
  "sandbox_detach_secret",
]

const PER_SANDBOX_TOOLS = [
  "sandbox_update",
  "sandbox_info",
  "sandbox_exec",
  "sandbox_files_read",
  "sandbox_files_write",
  "sandbox_files_list",
  "sandbox_files_download_dir",
  "sandbox_pause",
  "sandbox_resume",
  "sandbox_kill",
  "sandbox_preview_url",
  "sandbox_network_log",
  "sandbox_attach_secret",
  "sandbox_detach_secret",
]

describe("tool registration", () => {
  let conn: ConnectedClient
  // biome-ignore lint: vitest lifecycle
  let tools: Array<Record<string, any>>

  beforeEach(async () => {
    conn = await connect(createFakeClient().client)
    const res = await conn.client.listTools()
    tools = res.tools as Array<Record<string, any>>
  })
  afterEach(async () => {
    await conn.close()
  })

  const byName = (name: string) => tools.find((t) => t.name === name)

  it("registers exactly the v1 tool set", () => {
    expect(tools.map((t) => t.name).toSorted()).toEqual(
      EXPECTED_TOOLS.toSorted(),
    )
  })

  it("every tool has a non-empty description and input schema", () => {
    for (const t of tools) {
      expect(typeof t.description).toBe("string")
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.inputSchema).toBeDefined()
    }
  })

  it("per-sandbox tools require sandbox_id", () => {
    for (const name of PER_SANDBOX_TOOLS) {
      const t = byName(name)
      expect(t?.inputSchema?.required ?? []).toContain("sandbox_id")
    }
  })

  it("inlines every input schema — no $ref (strict clients/models can't resolve them)", () => {
    for (const t of tools) {
      expect(JSON.stringify(t.inputSchema)).not.toContain('"$ref"')
    }
  })

  it("exposes sandbox_create metadata and env_vars as inline object schemas", () => {
    const props = byName("sandbox_create")?.inputSchema?.properties
    expect(props?.metadata?.type).toBe("object")
    expect(props?.env_vars?.type).toBe("object")
  })

  it("declares honest read-only / destructive / idempotent hints", () => {
    expect(byName("sandbox_list")?.annotations?.readOnlyHint).toBe(true)
    expect(byName("sandbox_template_list")?.annotations?.readOnlyHint).toBe(
      true,
    )
    expect(byName("sandbox_info")?.annotations?.readOnlyHint).toBe(true)
    expect(byName("sandbox_files_read")?.annotations?.readOnlyHint).toBe(true)
    expect(byName("sandbox_files_list")?.annotations?.readOnlyHint).toBe(true)
    expect(
      byName("sandbox_files_download_dir")?.annotations?.readOnlyHint,
    ).toBe(true)
    // Publishing is a control-plane write even though it is idempotent.
    expect(byName("sandbox_preview_url")?.annotations?.readOnlyHint).toBe(false)
    // Audit read must not resume a paused sandbox → honestly read-only.
    expect(byName("sandbox_network_log")?.annotations?.readOnlyHint).toBe(true)
    expect(byName("secret_list")?.annotations?.readOnlyHint).toBe(true)

    expect(byName("sandbox_exec")?.annotations?.readOnlyHint).toBe(false)
    expect(byName("sandbox_create")?.annotations?.readOnlyHint).toBe(false)

    expect(byName("sandbox_kill")?.annotations?.destructiveHint).toBe(true)
    expect(byName("sandbox_kill")?.annotations?.idempotentHint).toBe(true)
    expect(byName("sandbox_pause")?.annotations?.idempotentHint).toBe(true)
    expect(byName("sandbox_files_write")?.annotations?.idempotentHint).toBe(
      true,
    )
  })

  it("advertises server-level instructions covering cross-tool workflow + limits", () => {
    const instructions = conn.client.getInstructions()
    expect(instructions).toBeTruthy()
    expect(instructions).toContain("sandbox_create")
    expect(instructions).toContain("secrets")
    // The first ~512 chars stay self-contained: core workflow + file-read limit.
    expect((instructions ?? "").slice(0, 512)).toMatch(/1 MiB/)
  })

  it("exposes sandbox_create secrets + egress rules as inline schemas", () => {
    const props = byName("sandbox_create")?.inputSchema?.properties
    expect(props?.secrets?.type).toBe("object")
    expect(props?.allow_out?.type).toBe("array")
    expect(props?.deny_out?.type).toBe("array")
  })
})
