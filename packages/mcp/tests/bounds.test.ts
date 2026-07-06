/**
 * Resource-bound regression tests: each asserts a hostile/oversized input is
 * refused before it can exhaust memory or pin a hosted invocation. Every test
 * here fails if its corresponding cap is removed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  MAX_AUTO_DELETE_SECONDS,
  MAX_DOWNLOAD_DIR_BYTES,
  MAX_EXEC_TIMEOUT_MS,
  MAX_FILE_BYTES,
  MAX_WRITE_BYTES,
} from "../src/constants.js"
import { createFakeClient } from "./fake-client.js"
import { callTool, type ConnectedClient, connect } from "./harness.js"

describe("resource bounds (in-memory, fake client)", () => {
  let fake: ReturnType<typeof createFakeClient>
  let conn: ConnectedClient

  beforeEach(async () => {
    fake = createFakeClient()
    conn = await connect(fake.client)
  })
  afterEach(async () => {
    await conn.close()
  })

  async function createSandbox(): Promise<string> {
    const r = await callTool(conn.client, "sandbox_create", { name: "t" })
    return r.structured.id as string
  }

  it("sandbox_create rejects auto_delete_seconds over the 30-day cap", async () => {
    const r = await callTool(conn.client, "sandbox_create", {
      name: "t",
      auto_delete_seconds: MAX_AUTO_DELETE_SECONDS + 1,
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/validation|too_big/i)
  })

  it("sandbox_files_read refuses a file over the read cap (no full buffering)", async () => {
    const id = await createSandbox()
    // A 2 MiB file is allowed to exist; the read cap is 1 MiB. The cap is passed
    // to the SDK, so the over-cap file is rejected instead of being buffered.
    await callTool(conn.client, "sandbox_files_write", {
      sandbox_id: id,
      path: "/app/big.log",
      content: "a".repeat(2 * 1024 * 1024),
    })
    const r = await callTool(conn.client, "sandbox_files_read", {
      sandbox_id: id,
      path: "/app/big.log",
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/larger than|read limit/i)
    expect(r.text).toContain("sandbox_exec")
  })

  it("sandbox_files_read still returns a file exactly at the cap", async () => {
    const id = await createSandbox()
    await callTool(conn.client, "sandbox_files_write", {
      sandbox_id: id,
      path: "/app/exact",
      content: "b".repeat(MAX_FILE_BYTES),
    })
    const r = await callTool(conn.client, "sandbox_files_read", {
      sandbox_id: id,
      path: "/app/exact",
    })
    expect(r.isError).toBe(false)
    expect(r.structured.bytes).toBe(MAX_FILE_BYTES)
  })

  it("sandbox_files_write refuses content over the write cap without writing", async () => {
    const id = await createSandbox()
    const w = await callTool(conn.client, "sandbox_files_write", {
      sandbox_id: id,
      path: "/app/huge",
      content: "c".repeat(MAX_WRITE_BYTES + 1),
    })
    expect(w.isError).toBe(true)
    expect(w.text).toMatch(/limited to|Refusing to write/i)
    // The oversized write never reached the sandbox.
    const list = await callTool(conn.client, "sandbox_files_list", {
      sandbox_id: id,
      path: "/app",
    })
    const names = (list.structured.entries as Array<{ name: string }>).map(
      (e) => e.name,
    )
    expect(names).not.toContain("huge")
  })

  it("sandbox_files_download_dir refuses a directory over the zip cap", async () => {
    const id = await createSandbox()
    // Seed an oversized file directly — the write tool's 8 MiB cap would block
    // it, and the SDK throws mid-stream rather than buffering the whole zip.
    fake.sandboxes
      .get(id)
      ?.files.set("/app/big.bin", new Uint8Array(MAX_DOWNLOAD_DIR_BYTES + 1))
    const r = await callTool(conn.client, "sandbox_files_download_dir", {
      sandbox_id: id,
      path: "/app",
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/more than|limit/i)
    expect(r.text).toContain("sandbox_files_read")
  })

  it("sandbox_exec clamps an oversized timeout_ms to the ceiling", async () => {
    const id = await createSandbox()
    await callTool(conn.client, "sandbox_exec", {
      sandbox_id: id,
      command: "echo hi",
      timeout_ms: 999_999_999,
    })
    expect(fake.lastExec?.opts.timeoutMs).toBe(MAX_EXEC_TIMEOUT_MS)
  })

  it("sandbox_exec passes a normal timeout_ms through unchanged", async () => {
    const id = await createSandbox()
    await callTool(conn.client, "sandbox_exec", {
      sandbox_id: id,
      command: "echo hi",
      timeout_ms: 5_000,
    })
    expect(fake.lastExec?.opts.timeoutMs).toBe(5_000)
  })
})
