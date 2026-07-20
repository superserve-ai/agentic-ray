/**
 * Build the data-plane preview URL for a port inside a sandbox.
 *
 * Superserve's edge proxy routes `https://{port}-{sandboxId}.{sandboxHost}` to
 * a published port in the sandbox. Authentication is enforced separately by
 * the edge proxy according to that published port's access mode.
 *
 * The data plane is `boxd-{id}.{host}` and previews are `{port}-{id}.{host}`,
 * on the same `{host}` — the sandbox's region-resolved data-plane host, which
 * the caller passes in (the SDK's `resolveConfig` is the single source for it).
 */

const DEFAULT_SANDBOX_HOST = "sandbox.superserve.ai"

/** Sandbox ids are UUIDs; refuse anything that could escape the hostname. */
const SANDBOX_ID_RE = /^[A-Za-z0-9-]+$/

// Privileged ports (< 1024) are refused by the edge proxy, so a preview URL
// targeting one would never route — reject up front. Matches the SDK's
// MIN_PREVIEW_PORT so both builders agree on what can be reached.
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
 * Build the preview URL for `port` on `sandboxId`.
 *
 * `sandboxHost` is the sandbox's data-plane host (region-resolved by the SDK's
 * `resolveConfig`); it defaults to the prod apex for callers without one.
 *
 * @throws {PreviewUrlError} when the port is not an integer in [1024, 65535] or
 * the sandbox id contains characters that are not URL-host-safe.
 */
export function buildPreviewUrl(
  sandboxId: string,
  port: number,
  sandboxHost: string = DEFAULT_SANDBOX_HOST,
): string {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new PreviewUrlError(
      `Port must be an integer between ${MIN_PORT} and ${MAX_PORT} (got ${port}).`,
    )
  }
  if (!SANDBOX_ID_RE.test(sandboxId)) {
    throw new PreviewUrlError(`Invalid sandbox id: ${sandboxId}`)
  }
  return `https://${port}-${sandboxId}.${sandboxHost}`
}
