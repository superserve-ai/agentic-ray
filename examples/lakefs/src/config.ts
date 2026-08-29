/**
 * Input validation shared by the coordinator (`src/multi-agent.ts`) and the
 * real-sandbox lifecycle test (`tests/sandbox-lifecycle.ts`). Both interpolate
 * these values into shell commands -- template build steps, curl calls -- so
 * both need the same guarantees, and neither should keep a private copy that
 * can drift from the other.
 *
 * These values come from the operator's own environment rather than an
 * untrusted caller, but an example that gets copy-pasted into a CI job -- where
 * they may come from a pipeline variable -- shouldn't hand a `$(...)` or a
 * quote straight to a shell.
 *
 * Each reader takes the environment as an argument so the rules can be tested
 * without mutating `process.env`; callers use the default.
 */

/** lakeFS repository and ref names: alphanumerics, dash, underscore, dot. */
const LAKEFS_IDENTIFIER = /^[A-Za-z0-9._-]+$/

/** Lowercase hex, as printed by `sha256sum`. */
const SHA256 = /^[a-f0-9]{64}$/

/** An API base URL, which has no business carrying a query or a fragment. */
const ENDPOINT_CHARS = /^[A-Za-z0-9:/._-]+$/

/**
 * RFC 3986 URL characters minus the single quote. Deliberately admits `?`,
 * `&`, and `=`, because lakeFS hands out presigned download URLs for Everest
 * and rejecting query strings would reject the documented input. The shell
 * metacharacters that survive this check (`&`, `;`, `$`, parentheses) are
 * defused by `shellQuote` at every interpolation site, and a literal `'` is
 * rejected here so that the quoting itself cannot be broken out of.
 */
const URL_CHARS = /^[A-Za-z0-9:/?@!$&()*+,;=._~%-]+$/

/**
 * POSIX single-quoting: everything between the quotes is literal except `'`
 * itself, which is closed, escaped, and reopened. Apply this wherever one of
 * these values is interpolated into a command.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function requiredEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function matching(name: string, pattern: RegExp, value: string): string {
  if (!pattern.test(value)) {
    throw new Error(`${name} must match ${pattern}`)
  }
  return value
}

export function requiredIdentifier(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return matching(name, LAKEFS_IDENTIFIER, requiredEnv(name, env))
}

export function requiredSha256(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return matching(name, SHA256, requiredEnv(name, env))
}

/** Rejects credentials, query strings, and anything a shell would expand. */
export function requiredEndpoint(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = requiredEnv(name, env)
  const url = parseUrl(name, raw)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must use http or https`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `${name} must not contain credentials, a query, or a fragment`,
    )
  }
  return matching(name, ENDPOINT_CHARS, raw.replace(/\/+$/, ""))
}

/**
 * The Everest artifact URL. Unlike the endpoint this keeps its query string,
 * since the URL lakeFS issues is usually presigned -- which is also why every
 * use of it goes through `shellQuote`. https is required because the build
 * step fetches it over the public internet; the checksum, not the transport,
 * is what ultimately verifies the artifact.
 */
export function requiredDownloadUrl(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = requiredEnv(name, env)
  const url = parseUrl(name, raw)
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use https`)
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials`)
  }
  if (url.hash) {
    throw new Error(`${name} must not contain a fragment`)
  }
  return matching(name, URL_CHARS, raw)
}

export function positiveInteger(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) {
    throw new Error(`${name} must be an integer between 1 and 16`)
  }
  return value
}

function parseUrl(name: string, raw: string): URL {
  try {
    return new URL(raw)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
}
