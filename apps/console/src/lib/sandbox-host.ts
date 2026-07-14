/**
 * Data-plane host resolution for a sandbox, keyed off the region token in its
 * public id (`sb-<region>-<uuid>`).
 *
 * Public sandbox ids carry their home cell (`sb-usw-…`), so every data-plane
 * URL (files, terminal, preview) can resolve the right proxy host from the id
 * alone — no team/region prop-threading, and it works in pure modules that
 * can't call hooks.
 *
 * The default cell (`use`, and legacy un-prefixed ids) keeps honoring
 * `NEXT_PUBLIC_SANDBOX_HOST` so staging/dev can point at `staging-sandbox…`.
 * Non-default cells resolve to their own host and ignore that override — a
 * `usw` sandbox is never reachable via the `use` proxy.
 *
 * Mirrors the SDK's region map (packages/sdk/src/config.ts). `use` stays on
 * the legacy `sandbox.superserve.ai` host until its proxy also accepts the
 * `use-sandbox` form; add it here once it does.
 */

const REGION_SANDBOX_HOSTS = new Map<string, string>([
  ["usw", "usw-sandbox.superserve.ai"],
])

const DEFAULT_SANDBOX_HOST =
  process.env.NEXT_PUBLIC_SANDBOX_HOST ?? "sandbox.superserve.ai"

/** Region token from a public sandbox id (`sb-<region>-<uuid>`), else undefined. */
export function regionFromSandboxId(sandboxId: string): string | undefined {
  return /^sb-([a-z0-9]{1,17})-/.exec(sandboxId)?.[1]
}

/** The data-plane host to reach a sandbox, derived from its id's region. */
export function sandboxHostFor(sandboxId: string): string {
  const region = regionFromSandboxId(sandboxId)
  return (
    (region ? REGION_SANDBOX_HOSTS.get(region) : undefined) ??
    DEFAULT_SANDBOX_HOST
  )
}
