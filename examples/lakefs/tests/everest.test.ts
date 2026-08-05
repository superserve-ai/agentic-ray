import type { BuildStep } from "@superserve/sdk"
import { describe, expect, it, vi } from "vitest"

import {
  EVEREST_UMOUNT_TIMEOUT_MS,
  everestBuildSteps,
  shutdownSandboxes,
  unmountAndKill,
} from "../src/everest"

const SHA = "b".repeat(64)

/**
 * A sandbox whose unmount and kill outcomes the test dictates. It satisfies
 * `UnmountableSandbox` structurally, which is the point of that interface --
 * no real sandbox, and no credentials, are needed to reach these paths.
 */
function fakeSandbox(
  id: string,
  outcomes: { unmount?: Error; kill?: Error } = {},
) {
  const run = vi.fn(
    async (_command: string, _options?: { timeoutMs?: number }) => {
      if (outcomes.unmount) throw outcomes.unmount
      return { exitCode: 0, stdout: "", stderr: "" }
    },
  )
  const kill = vi.fn(async () => {
    if (outcomes.kill) throw outcomes.kill
  })
  return { id, commands: { run }, kill, run }
}

/** Build steps are a union; only a run step has a command to assert on. */
function runCommand(steps: BuildStep[], index: number): string {
  const step = steps[index]
  if (!("run" in step)) throw new Error(`step ${index} is not a run step`)
  return step.run
}

describe("unmountAndKill", () => {
  it("unmounts, then kills", async () => {
    const sandbox = fakeSandbox("sbx-1")
    await unmountAndKill(sandbox, "/mnt/lakefs", () => {})

    expect(sandbox.run).toHaveBeenCalledWith("everest umount /mnt/lakefs", {
      timeoutMs: EVEREST_UMOUNT_TIMEOUT_MS,
    })
    expect(sandbox.kill).toHaveBeenCalledTimes(1)
  })

  // The failure this whole seam exists for: a wedged FUSE mount must not
  // leave a sandbox running (and billing) behind it.
  it("still kills when unmount rejects", async () => {
    const sandbox = fakeSandbox("sbx-1", { unmount: new Error("device busy") })
    const reportError = vi.fn()

    await expect(
      unmountAndKill(sandbox, "/mnt/lakefs", reportError),
    ).resolves.toBeUndefined()

    expect(sandbox.kill).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(
      expect.stringContaining("sbx-1"),
      expect.objectContaining({ message: "device busy" }),
    )
  })

  it("still kills when unmount times out", async () => {
    const timeout = Object.assign(new Error("Request timed out"), {
      name: "TimeoutError",
    })
    const sandbox = fakeSandbox("sbx-1", { unmount: timeout })

    await unmountAndKill(sandbox, "/mnt/lakefs", () => {})

    expect(sandbox.kill).toHaveBeenCalledTimes(1)
  })

  it("surfaces a kill failure rather than swallowing it", async () => {
    const sandbox = fakeSandbox("sbx-1", { kill: new Error("kill failed") })

    await expect(
      unmountAndKill(sandbox, "/mnt/lakefs", () => {}),
    ).rejects.toThrow(/kill failed/)
  })
})

describe("shutdownSandboxes", () => {
  it("kills every sandbox even when one unmount fails", async () => {
    const healthy = fakeSandbox("sbx-1")
    const wedged = fakeSandbox("sbx-2", { unmount: new Error("device busy") })
    const alsoHealthy = fakeSandbox("sbx-3")

    await shutdownSandboxes(
      [healthy, wedged, alsoHealthy],
      "/mnt/lakefs",
      () => {},
    )

    for (const sandbox of [healthy, wedged, alsoHealthy]) {
      expect(sandbox.kill).toHaveBeenCalledTimes(1)
    }
  })

  it("kills the remaining sandboxes when one kill fails, and reports it", async () => {
    const doomed = fakeSandbox("sbx-1", { kill: new Error("unreachable") })
    const healthy = fakeSandbox("sbx-2")
    const reportError = vi.fn()

    await shutdownSandboxes([doomed, healthy], "/mnt/lakefs", reportError)

    expect(healthy.kill).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(
      expect.stringContaining("sbx-1"),
      expect.objectContaining({ message: "unreachable" }),
    )
  })

  // It runs from a finally block, where throwing would replace the error that
  // actually caused the run to fail.
  it("never rejects, so it cannot mask the original failure", async () => {
    const doomed = fakeSandbox("sbx-1", {
      unmount: new Error("device busy"),
      kill: new Error("unreachable"),
    })

    await expect(
      shutdownSandboxes([doomed], "/mnt/lakefs", () => {}),
    ).resolves.toBeUndefined()
  })

  it("does nothing when no sandboxes were created", async () => {
    const reportError = vi.fn()
    await shutdownSandboxes([], "/mnt/lakefs", reportError)
    expect(reportError).not.toHaveBeenCalled()
  })
})

describe("everestBuildSteps", () => {
  it("quotes the download URL so a presigned query cannot split the command", () => {
    const url = "https://example.com/e.tar.gz?X-Amz-Signature=abc&Expires=1"
    const run = runCommand(everestBuildSteps(url, SHA), 1)

    expect(run).toContain(`curl -sfL -o /tmp/everest.tar.gz '${url}' &&`)
    // The `&` inside the URL must not read as a shell operator.
    expect(run).not.toContain(`${url} &&`)
  })

  it("verifies the checksum against the downloaded file", () => {
    const run = runCommand(
      everestBuildSteps("https://example.com/e.tar.gz", SHA),
      1,
    )
    expect(run).toContain(`'${SHA}  /tmp/everest.tar.gz' | sha256sum -c -`)
  })
})
