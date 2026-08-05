/**
 * The Everest bits both entry points need: how it gets into an image, how
 * long its operations are allowed to take, and how a sandbox running one of
 * its mounts is torn down.
 */

import type { BuildStep } from "@superserve/sdk"

import { shellQuote } from "./config"

// Disable stale remount caching and route object traffic through lakeFS until
// the Superserve egress proxy preserves Content-Length on presigned uploads.
// See the integration guide for the full rationale.
export const MOUNT_FLAGS = "--protocol fuse --k2=false --presign=false"

// Everest talks to lakeFS and object storage on every mount and commit, so
// these outlast the SDK's 30s default request timeout on a large dataset or a
// slow endpoint. Unmounting only tears down the local FUSE mount, so it gets a
// shorter budget -- but still one that survives a wedged mount.
export const EVEREST_MOUNT_TIMEOUT_MS = 180_000
export const EVEREST_UMOUNT_TIMEOUT_MS = 60_000

/**
 * Fetches Everest from the URL you supply and verifies it against the
 * checksum you supply. This example deliberately ships neither, so nothing
 * here redistributes lakeFS's artifact.
 *
 * `curl -f` matters more than it looks: a presigned download URL expires, and
 * without it curl would write the error page to the tarball and leave
 * `sha256sum` to report a checksum mismatch for what is really an expired URL.
 */
export function everestBuildSteps(
  downloadUrl: string,
  sha256: string,
): BuildStep[] {
  return [
    {
      run: "apt-get update && apt-get install -y ca-certificates curl python3 util-linux fuse3",
    },
    {
      run: [
        `curl -sfL -o /tmp/everest.tar.gz ${shellQuote(downloadUrl)}`,
        `echo ${shellQuote(`${sha256}  /tmp/everest.tar.gz`)} | sha256sum -c -`,
        "tar xzf /tmp/everest.tar.gz -C /usr/local/bin everest",
        "chmod +x /usr/local/bin/everest",
        "rm /tmp/everest.tar.gz",
      ].join(" && "),
    },
  ]
}

/**
 * Only the surface teardown needs, so a test can stand in a sandbox whose
 * unmount fails. A real `Sandbox` satisfies it.
 */
export interface UnmountableSandbox {
  readonly id: string
  readonly commands: {
    run(command: string, options?: { timeoutMs?: number }): Promise<unknown>
  }
  kill(): Promise<unknown>
}

type ReportError = (message: string, error: unknown) => void

/**
 * Unmount is best-effort; kill is not. A wedged FUSE mount or an unreachable
 * sandbox must never strand a running sandbox, so an unmount failure is
 * reported and then stepped over -- `kill` is the call that actually stops
 * billing.
 */
export async function unmountAndKill(
  sandbox: UnmountableSandbox,
  mountPath: string,
  reportError: ReportError = console.error,
): Promise<void> {
  try {
    await sandbox.commands.run(`everest umount ${mountPath}`, {
      timeoutMs: EVEREST_UMOUNT_TIMEOUT_MS,
    })
  } catch (error) {
    reportError(
      `failed to unmount sandbox ${sandbox.id}; killing it anyway:`,
      error,
    )
  }
  await sandbox.kill()
}

/**
 * Tears every sandbox down even if one of them fails, then reports what
 * failed. It resolves rather than throwing because callers run it from a
 * `finally` block, where throwing would mask the original error.
 */
export async function shutdownSandboxes(
  sandboxes: readonly UnmountableSandbox[],
  mountPath: string,
  reportError: ReportError = console.error,
): Promise<void> {
  const results = await Promise.allSettled(
    sandboxes.map((sandbox) => unmountAndKill(sandbox, mountPath, reportError)),
  )
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      reportError(
        `failed to clean up sandbox ${sandboxes[index].id}:`,
        result.reason,
      )
    }
  })
}
