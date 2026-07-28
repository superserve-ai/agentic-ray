import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createFakeClient } from "./fake-client.js"
import { callTool, type ConnectedClient, connect } from "./harness.js"

describe("network rules + sandbox_update (in-memory, fake client)", () => {
  let conn: ConnectedClient

  beforeEach(async () => {
    conn = await connect(createFakeClient().client)
  })
  afterEach(async () => {
    await conn.close()
  })

  it("create accepts egress rules + secret bindings; info reflects them", async () => {
    const created = await callTool(conn.client, "sandbox_create", {
      name: "net",
      allow_out: ["api.github.com"],
      secrets: { OPENAI_API_KEY: "openai-prod" },
    })
    const id = created.structured.id as string

    const info = await callTool(conn.client, "sandbox_info", { sandbox_id: id })
    expect(
      (info.structured.network as { allow_out: string[] }).allow_out,
    ).toEqual(["api.github.com"])
    const secrets = info.structured.secrets as Array<Record<string, unknown>>
    expect(secrets[0].env_key).toBe("OPENAI_API_KEY")
    expect(secrets[0].secret_name).toBe("openai-prod")
    // The real secret value must never surface in sandbox metadata.
    expect(secrets[0]).not.toHaveProperty("value")
  })

  it("sandbox_update changes egress rules on an existing sandbox", async () => {
    const created = await callTool(conn.client, "sandbox_create", { name: "u" })
    const id = created.structured.id as string

    const upd = await callTool(conn.client, "sandbox_update", {
      sandbox_id: id,
      deny_out: ["evil.example.com"],
    })
    expect(upd.isError).toBe(false)

    const info = await callTool(conn.client, "sandbox_info", { sandbox_id: id })
    expect(
      (info.structured.network as { deny_out: string[] }).deny_out,
    ).toEqual(["evil.example.com"])
  })

  it("sandbox_update arms and clears the auto-delete window", async () => {
    const created = await callTool(conn.client, "sandbox_create", {
      name: "gc",
      auto_delete_seconds: 3600,
    })
    const id = created.structured.id as string

    let info = await callTool(conn.client, "sandbox_info", { sandbox_id: id })
    expect(info.structured.auto_delete_seconds).toBe(3600)

    const upd = await callTool(conn.client, "sandbox_update", {
      sandbox_id: id,
      auto_delete_seconds: null,
    })
    expect(upd.isError).toBe(false)

    info = await callTool(conn.client, "sandbox_info", { sandbox_id: id })
    expect(info.structured.auto_delete_seconds).toBeUndefined()
  })
})

describe("secrets (in-memory, fake client)", () => {
  let fake: ReturnType<typeof createFakeClient>
  let conn: ConnectedClient

  beforeEach(async () => {
    fake = createFakeClient()
    fake.secrets.push({
      name: "openai-prod",
      authType: "bearer",
      hosts: ["api.openai.com"],
      providerShortcut: "openai",
    })
    conn = await connect(fake.client)
  })
  afterEach(async () => {
    await conn.close()
  })

  it("secret_list returns metadata only — never values", async () => {
    const r = await callTool(conn.client, "secret_list")
    expect(r.isError).toBe(false)
    const secrets = r.structured.secrets as Array<Record<string, unknown>>
    expect(secrets.map((s) => s.name)).toEqual(["openai-prod"])
    expect(secrets[0]).not.toHaveProperty("value")
    expect(r.text).toContain("openai-prod")
  })

  it("attach then detach a secret round-trips through info", async () => {
    const created = await callTool(conn.client, "sandbox_create", { name: "s" })
    const id = created.structured.id as string

    await callTool(conn.client, "sandbox_attach_secret", {
      sandbox_id: id,
      env_key: "OPENAI_API_KEY",
      secret_name: "openai-prod",
    })
    let info = await callTool(conn.client, "sandbox_info", { sandbox_id: id })
    expect(
      (info.structured.secrets as Array<Record<string, unknown>>)[0].env_key,
    ).toBe("OPENAI_API_KEY")

    await callTool(conn.client, "sandbox_detach_secret", {
      sandbox_id: id,
      env_key: "OPENAI_API_KEY",
    })
    info = await callTool(conn.client, "sandbox_info", { sandbox_id: id })
    expect(info.structured.secrets).toBeUndefined()
  })
})

describe("sandbox_template_create (in-memory, fake client)", () => {
  let conn: ConnectedClient

  beforeEach(async () => {
    conn = await connect(createFakeClient().client)
  })
  afterEach(async () => {
    await conn.close()
  })

  it("kicks off a build and lists it as building with the requested shape", async () => {
    const r = await callTool(conn.client, "sandbox_template_create", {
      name: "my-4cpu",
      from: "python:3.11",
      vcpu: 4,
      memory_mib: 8192,
      run_steps: ["pip install numpy"],
    })
    expect(r.isError).toBe(false)
    const t = r.structured.template as Record<string, unknown>
    expect(t.name).toBe("my-4cpu")
    expect(t.vcpu).toBe(4)
    expect(t.status).toBe("building")
    // The agent is told to poll until ready before using it.
    expect(r.text).toMatch(/ready/)

    const list = await callTool(conn.client, "sandbox_template_list", {
      name_prefix: "my-4cpu",
    })
    expect(
      (list.structured.templates as Array<{ name: string }>).map((x) => x.name),
    ).toContain("my-4cpu")
  })
})

describe("sandbox_preview_url (in-memory, fake client)", () => {
  let conn: ConnectedClient

  beforeEach(async () => {
    conn = await connect(createFakeClient().client)
  })
  afterEach(async () => {
    await conn.close()
  })

  it("publishes and returns the public {port}-{id} preview URL", async () => {
    const created = await callTool(conn.client, "sandbox_create", { name: "p" })
    const id = created.structured.id as string

    const r = await callTool(conn.client, "sandbox_preview_url", {
      sandbox_id: id,
      port: 8000,
    })
    expect(r.isError).toBe(false)
    expect(r.structured.url).toBe(`https://8000-${id}.sandbox.superserve.ai`)
    expect(r.structured.access).toBe("public")
    expect(r.structured.previewAccess).toBe("public")
    expect(r.structured.authenticated).toBe(false)
  })

  it("returns a signed URL for a private port", async () => {
    const created = await callTool(conn.client, "sandbox_create", {
      name: "private",
      preview_access: "private",
    })
    const id = created.structured.id as string

    const r = await callTool(conn.client, "sandbox_preview_url", {
      sandbox_id: id,
      port: 8000,
      expires_in_seconds: 60,
    })
    expect(r.isError).toBe(false)
    expect(r.structured.access).toBe("private")
    expect(r.structured.previewAccess).toBe("private")
    expect(r.structured.authenticated).toBe(true)
    expect(r.structured.url).toContain("superserve_preview_token=")
  })

  it("rejects a sandbox id that is not host-safe (no URL injection)", async () => {
    const r = await callTool(conn.client, "sandbox_preview_url", {
      sandbox_id: "evil.example.com",
      port: 8080,
    })
    expect(r.isError).toBe(true)
  })
})

describe("sandbox_network_log (in-memory, fake client)", () => {
  it("returns recent egress rows for a sandbox", async () => {
    const fake = createFakeClient()
    fake.networkEvents.push(
      {
        kind: "connection",
        id: 2,
        ts: new Date(2000),
        host: "api.github.com",
        verdict: "allowed",
      },
      {
        kind: "request",
        id: 1,
        ts: new Date(1000),
        host: "api.openai.com",
        method: "POST",
        path: "/v1/chat",
        status: 200,
      },
    )
    const conn = await connect(fake.client)
    try {
      const created = await callTool(conn.client, "sandbox_create", {
        name: "n",
      })
      const id = created.structured.id as string

      const r = await callTool(conn.client, "sandbox_network_log", {
        sandbox_id: id,
      })
      expect(r.isError).toBe(false)
      expect((r.structured.events as unknown[]).length).toBe(2)
      expect(r.text).toContain("api.github.com")
    } finally {
      await conn.close()
    }
  })

  it("does not resume a paused sandbox (read-only audit)", async () => {
    const conn = await connect(createFakeClient().client)
    try {
      const created = await callTool(conn.client, "sandbox_create", {
        name: "np",
      })
      const id = created.structured.id as string
      await callTool(conn.client, "sandbox_pause", { sandbox_id: id })

      const r = await callTool(conn.client, "sandbox_network_log", {
        sandbox_id: id,
      })
      expect(r.isError).toBe(false)

      const info = await callTool(conn.client, "sandbox_info", {
        sandbox_id: id,
      })
      expect(info.structured.status).toBe("paused")
    } finally {
      await conn.close()
    }
  })
})
