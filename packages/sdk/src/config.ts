/**
 * Connection configuration for the Superserve SDK.
 *
 * Resolves API key and base URLs from explicit options or environment
 * variables. Constructs the data-plane URL for per-sandbox file operations.
 */

import { AuthenticationError, ValidationError } from "./errors.js"

const DEFAULT_BASE_URL = "https://api.superserve.ai"
const DEFAULT_SANDBOX_HOST = "sandbox.superserve.ai"

/**
 * Known Superserve regions, keyed by the region token embedded in API keys
 * (`ss_live_<region>_<random>`).
 *
 * Only regions whose DNS is live may be listed here: the SDK must never
 * construct a hostname before that region's endpoints exist. `usw` will be
 * added once `https://api-usw.superserve.ai` / `usw-sandbox.superserve.ai`
 * are up.
 *
 * Legacy keys (`ss_live_<random>`, whose base64url random part may itself
 * contain `_`) can coincidentally parse as having a region segment. That is
 * harmless by design: any token not in this map falls back to the defaults,
 * which is correct for every legacy key (they are all us-east).
 */
const KNOWN_REGIONS: ReadonlyMap<
  string,
  { baseUrl: string; sandboxHost: string }
> = new Map([
  [
    "use",
    {
      baseUrl: "https://api.superserve.ai",
      sandboxHost: "sandbox.superserve.ai",
    },
  ],
])

// Region token in `ss_live_<region>_<random>`: 1-17 lowercase alphanumeric
// chars, followed by at least one more character of key material.
const REGION_KEY_RE = /^ss_live_([a-z0-9]{1,17})_./

export interface ResolvedConfig {
  apiKey: string
  baseUrl: string
  sandboxHost: string
}

/**
 * Resolve connection config from explicit options + environment variables.
 *
 * Priority: explicit option > SUPERSERVE_API_KEY / SUPERSERVE_BASE_URL env vars.
 * Base URL priority continues: region derived from the API key via
 * `KNOWN_REGIONS` > `DEFAULT_BASE_URL`. The sandbox host follows the same
 * source (derived from the override URL, or taken from the region map).
 * Throws if no API key can be resolved.
 */
export function resolveConfig(opts?: {
  apiKey?: string
  baseUrl?: string
}): ResolvedConfig {
  const apiKey = opts?.apiKey ?? process.env.SUPERSERVE_API_KEY
  if (!apiKey) {
    throw new AuthenticationError(
      "Missing API key. Pass `apiKey` or set the SUPERSERVE_API_KEY environment variable.",
    )
  }
  const overrideUrl = opts?.baseUrl ?? process.env.SUPERSERVE_BASE_URL
  if (overrideUrl !== undefined) {
    return {
      apiKey,
      baseUrl: overrideUrl,
      sandboxHost: deriveSandboxHost(overrideUrl),
    }
  }
  const region = regionFromApiKey(apiKey)
  const endpoints = region !== undefined ? KNOWN_REGIONS.get(region) : undefined
  if (endpoints !== undefined) {
    return {
      apiKey,
      baseUrl: endpoints.baseUrl,
      sandboxHost: endpoints.sandboxHost,
    }
  }
  return {
    apiKey,
    baseUrl: DEFAULT_BASE_URL,
    sandboxHost: DEFAULT_SANDBOX_HOST,
  }
}

/**
 * Extract the candidate region token from an API key, if any.
 *
 * Returns `undefined` for legacy keys and anything else that doesn't match
 * `ss_live_<region>_<random>`. Never throws on weird keys.
 */
function regionFromApiKey(apiKey: string): string | undefined {
  return REGION_KEY_RE.exec(apiKey)?.[1]
}

// Sandbox hosts where the proxy supports shared-host routing.
const SUPPORTED_SHARED_HOSTS: ReadonlySet<string> = new Set([
  "sandbox.superserve.ai",
  "staging-sandbox.superserve.ai",
])

const SANDBOX_ID_HEADER = "X-Superserve-Sandbox-Id"

/** Base URL + routing headers for one data-plane request. */
export interface DataPlaneTarget {
  url: string
  headers: Record<string, string>
}

/**
 * Resolve the data-plane base URL + routing headers for a sandbox.
 *
 * On a supported host (server-side), routes via the shared origin with
 * `X-Superserve-Sandbox-Id`. Browsers and unsupported hosts use the
 * per-sandbox subdomain.
 */
export function dataPlaneTarget(
  sandboxId: string,
  sandboxHost: string,
): DataPlaneTarget {
  const isBrowser = typeof window !== "undefined"
  const host = sandboxHost.toLowerCase()
  if (!isBrowser && SUPPORTED_SHARED_HOSTS.has(host)) {
    return {
      url: `https://${host}`,
      headers: { [SANDBOX_ID_HEADER]: sandboxId },
    }
  }
  return {
    url: `https://boxd-${sandboxId}.${host}`,
    headers: {},
  }
}

/**
 * Lowest / highest TCP port a preview URL can target. Privileged ports
 * (< 1024) are refused by the edge proxy, so we reject them up front.
 *
 * Mirrored by the console (apps/console/src/hooks/use-preview-ports.ts) and the
 * Python SDK; keep all three in sync. Tests pin the literals on each side so
 * one-sided drift fails CI.
 */
export const MIN_PREVIEW_PORT = 1024
export const MAX_PREVIEW_PORT = 65535

/**
 * Build the public preview URL for a port running inside a sandbox.
 *
 * The edge proxy routes `https://{port}-{id}.{host}` straight to that port
 * on the VM, so this is pure string construction — no network call. The
 * sandbox must be running and a server must be listening on `port` for the
 * URL to resolve.
 *
 * Always uses the per-sandbox subdomain form (never the shared-host mode):
 * a browser opening the URL can't send the `X-Superserve-Sandbox-Id` header.
 *
 * @throws {ValidationError} if `port` is not an integer in [1024, 65535].
 */
export function previewUrl(
  sandboxId: string,
  sandboxHost: string,
  port: number,
): string {
  if (
    !Number.isInteger(port) ||
    port < MIN_PREVIEW_PORT ||
    port > MAX_PREVIEW_PORT
  ) {
    throw new ValidationError(
      `Invalid preview port ${port}: must be an integer between ${MIN_PREVIEW_PORT} and ${MAX_PREVIEW_PORT}. Privileged ports (< ${MIN_PREVIEW_PORT}) are not proxied.`,
    )
  }
  return `https://${port}-${sandboxId}.${sandboxHost}`
}

/**
 * Derive the data-plane sandbox host from the control-plane base URL.
 *
 * `https://api.superserve.ai`         → `sandbox.superserve.ai`
 * `https://api-staging.superserve.ai` → `staging-sandbox.superserve.ai`
 * Any other URL                        → `sandbox.superserve.ai` (safe default)
 */
function deriveSandboxHost(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname
    if (host === "api-staging.superserve.ai") {
      return "staging-sandbox.superserve.ai"
    }
    if (host === "api.superserve.ai") {
      return "sandbox.superserve.ai"
    }
  } catch {
    // Invalid URL — use default
  }
  return DEFAULT_SANDBOX_HOST
}
