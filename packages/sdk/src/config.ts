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
 * A region may be listed here only once its endpoints ACTUALLY SERVE THE
 * API — DNS resolving is not the bar: superserve.ai has a catch-all
 * wildcard, so every derived hostname resolves and answers with a
 * valid-TLS 404 from the wrong infrastructure. Verify with a live /health
 * check, not dig. `usw` was added once `https://api-usw.superserve.ai`
 * / `usw-sandbox.superserve.ai` served their cell end-to-end.
 *
 * Legacy keys (`ss_live_<random>`) can never be misread as region-tagged:
 * both key formats embed the same fixed-length 32-char base64url random
 * tail (from `crypto.randomBytes(24)`), and `REGION_KEY_RE` requires that
 * exact tail length anchored to the end of the string. A legacy key has no
 * room left over for a region segment on top of its own 32-char tail, so no
 * random legacy key can ever collide with a real region token — this holds
 * regardless of how many regions `KNOWN_REGIONS` ends up containing.
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
  [
    "usw",
    {
      baseUrl: "https://api-usw.superserve.ai",
      sandboxHost: "usw-sandbox.superserve.ai",
    },
  ],
])

// Region token in `ss_live_<region>_<random>`: 1-17 lowercase alphanumeric
// chars, then `_`, then exactly the 32-char base64url tail every key is
// minted with — anchored to the end so a legacy key's own tail can never be
// mistaken for `<region>_<tail>`.
const REGION_KEY_RE = /^ss_live_([a-z0-9]{1,17})_[A-Za-z0-9_-]{32}$/

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
  // A set-but-empty/whitespace override (e.g. SUPERSERVE_BASE_URL="") is treated
  // as unset, so it falls through to region derivation instead of becoming a
  // real override that yields an empty base URL (which throws in `new URL`) and
  // silently bypasses region derivation for a region-tagged key.
  const rawOverride = opts?.baseUrl ?? process.env.SUPERSERVE_BASE_URL
  const overrideUrl = rawOverride?.trim() || undefined
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
 * Extract the region token from an API key, if any.
 *
 * Returns `undefined` for legacy keys and anything else that doesn't match
 * `ss_live_<region>_<random-32-char-base64url>`. Never throws on weird keys.
 */
function regionFromApiKey(apiKey: string): string | undefined {
  return REGION_KEY_RE.exec(apiKey)?.[1]
}

// Sandbox hosts where the proxy supports shared-host routing (shared origin +
// X-Superserve-Sandbox-Id, server-side only). `usw-sandbox.superserve.ai` is
const SUPPORTED_SHARED_HOSTS: ReadonlySet<string> = new Set([
  "sandbox.superserve.ai",
  "staging-sandbox.superserve.ai",
  "usw-sandbox.superserve.ai",
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
 * Cells are matched off `KNOWN_REGIONS` (which already pairs each base URL with
 * its sandbox host), so a new cell needs only its map entry — no second edit
 * here. Staging is the one host that isn't a region cell, so it stays special.
 *
 * `https://api.superserve.ai`         → `sandbox.superserve.ai`      (map: use)
 * `https://api-usw.superserve.ai`     → `usw-sandbox.superserve.ai`  (map: usw)
 * `https://api-staging.superserve.ai` → `staging-sandbox.superserve.ai`
 * Any other URL                        → `sandbox.superserve.ai` (safe default)
 */
function deriveSandboxHost(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname
    if (host === "api-staging.superserve.ai") {
      return "staging-sandbox.superserve.ai"
    }
    for (const cell of KNOWN_REGIONS.values()) {
      if (new URL(cell.baseUrl).hostname === host) {
        return cell.sandboxHost
      }
    }
  } catch {
    // Invalid URL — use default
  }
  return DEFAULT_SANDBOX_HOST
}
