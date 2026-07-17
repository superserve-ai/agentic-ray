/**
 * Build the data-plane preview URL for a port inside a sandbox.
 *
 * Superserve's edge proxy routes `https://{port}-{sandboxId}.{sandboxHost}` to
 * a published port in the sandbox. Authentication is enforced separately by
 * the edge proxy according to the sandbox's preview policy.
 *
 * The host map mirrors the SDK's `deriveSandboxHost` (packages/sdk/src/config.ts)
 * — the data plane is `boxd-{id}.{host}`, previews are `{port}-{id}.{host}`. Keep
 * the two in sync if the platform host mapping ever changes.
 */

/** Default control-plane base URL (mirrors the SDK). */
export const DEFAULT_BASE_URL = "https://api.superserve.ai"
const DEFAULT_SANDBOX_HOST = "sandbox.superserve.ai"

/** Sandbox ids are UUIDs; refuse anything that could escape the hostname. */
const SANDBOX_ID_RE = /^[A-Za-z0-9-]+$/

const MIN_PORT = 1024
const MAX_PORT = 65535

/** Raised for an out-of-range port or a malformed sandbox id. */
export class PreviewUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PreviewUrlError"
  }
}

/**
 * Derive the data-plane sandbox host from the control-plane base URL.
 * Mirrors the SDK so a preview URL lands on the same apex as the data plane.
 */
export function deriveSandboxHost(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname
    if (host === "api-staging.superserve.ai") {
      return "staging-sandbox.superserve.ai"
    }
    if (host === "api.superserve.ai") {
      return "sandbox.superserve.ai"
    }
  } catch {
    // Invalid URL — fall through to the safe default.
  }
  return DEFAULT_SANDBOX_HOST
}

/**
 * Build the preview URL for `port` on `sandboxId`.
 *
 * @throws {PreviewUrlError} when the port is not an integer in [1024, 65535] or the
 * sandbox id contains characters that are not URL-host-safe.
 */
export function buildPreviewUrl(
  sandboxId: string,
  port: number,
  baseUrl: string = DEFAULT_BASE_URL,
): string {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new PreviewUrlError(
      `Port must be an integer between ${MIN_PORT} and ${MAX_PORT} (got ${port}).`,
    )
  }
  if (!SANDBOX_ID_RE.test(sandboxId)) {
    throw new PreviewUrlError(`Invalid sandbox id: ${sandboxId}`)
  }
  return `https://${port}-${sandboxId}.${deriveSandboxHost(baseUrl)}`
}
