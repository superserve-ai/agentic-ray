#!/usr/bin/env bun
/**
 * Verifies the API Reference nav in docs/docs.json stays in sync with the
 * OpenAPI spec it points at. Fails if the spec documents an operation that
 * isn't listed in the nav (so it never renders), or if the nav lists an
 * operation the spec doesn't define (a stale or mistyped entry).
 *
 * The spec is fetched from the URL in docs.json, so this also enforces that a
 * nav entry can only land once the backing spec change is live.
 */

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]

// Paths defined in the spec but intentionally absent from the public nav.
// Billing/pricing are UI endpoints (console pricing page), not part of the
// developer sandbox API reference.
const EXEMPT_PATHS = new Set([
  "/health",
  "/billing/pricing",
  "/billing/pricing/public",
  "/teams/{team_id}/billing/usage",
  "/teams/{team_id}/billing/periods",
  "/teams/{team_id}/billing/periods/{period_id}/export-preview",
  "/stripe/checkout-session",
  "/stripe/customer-portal-session",
  "/stripe/webhook",
])

const OP_RE = new RegExp(`^(${HTTP_METHODS.join("|")})\\s+/`)

type DocsConfig = {
  navigation: unknown
}

// Walks the whole navigation tree so the check works regardless of which
// division type (tab, anchor, dropdown, group, ...) carries the `openapi`
// field and the endpoint entries.
function navOpsFromDocs(docs: DocsConfig): {
  ops: Set<string>
  specUrl: string
} {
  const ops = new Set<string>()
  const specUrls = new Set<string>()

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!node || typeof node !== "object") {
      if (typeof node === "string" && OP_RE.test(node)) {
        ops.add(node.replace(/\s+/g, " ").trim())
      }
      return
    }
    const record = node as Record<string, unknown>
    if (typeof record.openapi === "string") specUrls.add(record.openapi)
    for (const value of Object.values(record)) walk(value)
  }

  walk(docs.navigation)
  if (specUrls.size !== 1) {
    throw new Error(
      `expected exactly one distinct \`openapi\` spec URL in docs.json navigation, found ${specUrls.size}`,
    )
  }
  return { ops, specUrl: [...specUrls][0] }
}

function specOps(spec: unknown): Set<string> {
  const ops = new Set<string>()
  const paths =
    spec && typeof spec === "object"
      ? (spec as { paths?: unknown }).paths
      : null
  if (!paths || typeof paths !== "object") return ops
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue
    for (const key of Object.keys(item)) {
      const method = key.toUpperCase()
      if (HTTP_METHODS.includes(method)) ops.add(`${method} ${path}`)
    }
  }
  return ops
}

const docsPath = new URL("../docs/docs.json", import.meta.url)
const docs = (await Bun.file(docsPath).json()) as DocsConfig
const { ops: nav, specUrl } = navOpsFromDocs(docs)

const res = await fetch(specUrl)
if (!res.ok) {
  console.error(`failed to fetch OpenAPI spec (${res.status}): ${specUrl}`)
  process.exit(1)
}
const api = specOps(Bun.YAML.parse(await res.text()))
if (api.size === 0) {
  console.error(
    `OpenAPI spec produced no operations (fetch or parse problem): ${specUrl}`,
  )
  process.exit(1)
}

const missingFromNav = [...api].filter((op) => {
  const path = op.split(" ", 2)[1]
  return !EXEMPT_PATHS.has(path) && !nav.has(op)
})
const missingFromSpec = [...nav].filter((op) => !api.has(op))

if (missingFromNav.length || missingFromSpec.length) {
  if (missingFromNav.length) {
    console.error(
      "Documented in the OpenAPI spec but missing from the docs nav:",
    )
    for (const op of missingFromNav.toSorted()) console.error(`  - ${op}`)
    console.error("Add these to the API Reference group in docs/docs.json.\n")
  }
  if (missingFromSpec.length) {
    console.error("Listed in the docs nav but not defined in the OpenAPI spec:")
    for (const op of missingFromSpec.toSorted()) console.error(`  - ${op}`)
    console.error("Remove these from docs/docs.json or fix the path/method.\n")
  }
  process.exit(1)
}

console.log(`docs nav in sync with OpenAPI spec (${api.size} operations).`)
