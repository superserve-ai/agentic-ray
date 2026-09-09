import { ConflictError, Sandbox } from "@superserve/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

// Sandboxes resolve DNS through these. A deny-all rule blocks them too, so
// every strict allowlist in this file includes them.
const RESOLVERS = ["1.1.1.1/32", "8.8.8.8/32"]

const opts = hasCredentials()
  ? connectionOptions()
  : { apiKey: "", baseUrl: "" }

/**
 * HTTP status from inside the sandbox, or BLOCKED when the connection never
 * completes. Certificate validation is off: this measures network policy, and
 * an allowlisted literal IP will not have a certificate for that IP.
 */
async function probe(sandbox: Sandbox, url: string): Promise<string> {
  const r = await sandbox.commands.run(
    `code=$(curl -ksS -m 8 -o /dev/null -w '%{http_code}' ${url} 2>/dev/null) || code=BLOCKED; echo "$code"`,
  )
  return r.stdout.trim()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!hasCredentials())("network rules", () => {
  let sandbox: Sandbox

  beforeAll(async () => {
    sandbox = await Sandbox.create({
      name: `sdk-e2e-network-${RUN_ID}`,
      network: {
        allowOut: [...RESOLVERS, "example.com"],
        denyOut: ["0.0.0.0/0"],
      },
      ...opts,
    })
  })

  afterAll(async () => {
    if (!sandbox?.id) return
    try {
      await sandbox.kill()
    } catch (err) {
      console.error(`Cleanup failed for sandbox ${sandbox.id}:`, err)
    }
  })

  it("reaches an allowlisted domain", async () => {
    expect(await probe(sandbox, "https://example.com/")).toBe("200")
  })

  it("blocks a destination no rule allows", async () => {
    expect(await probe(sandbox, "https://9.9.9.9/")).toBe("BLOCKED")
  })

  it("records both verdicts in the network log", async () => {
    await sleep(4000)
    const page = await sandbox.getNetworkLog({ limit: 50 })
    const connections = page.events.filter((e) => e.kind === "connection")
    const allowed = connections.find((e) => e.host === "example.com")
    const blocked = connections.find(
      (e) => e.dstIp === "9.9.9.9" || e.host === "9.9.9.9",
    )
    expect(allowed?.verdict).toBe("allowed")
    expect(blocked?.verdict).toBe("blocked")
  })

  it("rejects a network update while paused, then applies it once active", async () => {
    await sandbox.pause()
    await expect(
      sandbox.update({
        network: {
          allowOut: [...RESOLVERS, "example.com", "9.9.9.9/32"],
          denyOut: ["0.0.0.0/0"],
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    await sandbox.resume()
    await sandbox.update({
      network: {
        allowOut: [...RESOLVERS, "example.com", "9.9.9.9/32"],
        denyOut: ["0.0.0.0/0"],
      },
    })
    // 9.9.9.9 answers HTTPS with a non-200 page; anything but BLOCKED means the rule applied.
    expect(await probe(sandbox, "https://9.9.9.9/")).not.toBe("BLOCKED")
  })
})

// A bare IP in a rule must behave exactly like its /32. Before the API
// normalized these, a bare IP validated but failed to apply, and the sandbox
// silently ran with no rules at all.
describe.skipIf(!hasCredentials())("network rules: bare IP entries", () => {
  let sandbox: Sandbox

  beforeAll(async () => {
    sandbox = await Sandbox.create({
      name: `sdk-e2e-network-bare-${RUN_ID}`,
      network: {
        allowOut: ["1.1.1.1", "8.8.8.8", "example.com"],
        denyOut: ["0.0.0.0/0"],
      },
      ...opts,
    })
  })

  afterAll(async () => {
    if (!sandbox?.id) return
    try {
      await sandbox.kill()
    } catch (err) {
      console.error(`Cleanup failed for sandbox ${sandbox.id}:`, err)
    }
  })

  it("read back as single-host prefixes", async () => {
    const info = await sandbox.getInfo()
    expect(info.network?.allowOut).toEqual(
      expect.arrayContaining(["1.1.1.1/32", "8.8.8.8/32", "example.com"]),
    )
    expect(info.network?.allowOut).not.toContain("1.1.1.1")
  })

  it("are enforced like any other CIDR", async () => {
    expect(await probe(sandbox, "https://example.com/")).toBe("200")
    expect(await probe(sandbox, "https://9.9.9.9/")).toBe("BLOCKED")
  })
})

describe.skipIf(!hasCredentials())("network defaults", () => {
  let sandbox: Sandbox

  beforeAll(async () => {
    sandbox = await Sandbox.create({
      name: `sdk-e2e-network-open-${RUN_ID}`,
      ...opts,
    })
  })

  afterAll(async () => {
    if (!sandbox?.id) return
    try {
      await sandbox.kill()
    } catch (err) {
      console.error(`Cleanup failed for sandbox ${sandbox.id}:`, err)
    }
  })

  it("allows public egress with no rules", async () => {
    expect(await probe(sandbox, "https://example.com/")).toBe("200")
  })

  it("always blocks private and link-local ranges", async () => {
    // These drops happen below the layer the network log observes, so the
    // check is on curl's failure mode: a dropped packet times out (28), while
    // a reachable host with no listener would refuse (7) or reset (56).
    const r = await sandbox.commands.run(
      "for h in 10.0.0.1 169.254.169.254; do curl -ksS -m 4 -o /dev/null https://$h/ 2>/dev/null; echo $h=$?; done",
    )
    const lines = r.stdout.trim().split("\n")
    expect(lines).toContain("10.0.0.1=28")
    expect(lines).toContain("169.254.169.254=28")
  })
})
