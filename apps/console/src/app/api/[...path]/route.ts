import type { User } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import {
  getApiBaseUrlForUser,
  getAuthApiKeyForUser,
} from "@/lib/api/proxy-auth"
import { redactAccessTokens } from "@/lib/api/redact"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL ?? "https://api.superserve.ai"

const ALLOWED_PREFIXES = [
  "sandboxes",
  "activity",
  "health",
  "v1",
  "templates",
  "secrets",
  "providers",
  "billing/summary",
]

function isTeamBillingPath(path: string): boolean {
  return (
    /^teams\/[^/]+\/billing\/usage$/.test(path) ||
    /^teams\/[^/]+\/billing\/periods$/.test(path) ||
    /^teams\/[^/]+\/billing\/periods\/[^/]+\/export-preview$/.test(path)
  )
}

function isStripeBillingPath(path: string): boolean {
  return (
    path === "stripe/checkout-session" ||
    path === "stripe/customer-portal-session"
  )
}

/** Paths that carry their own auth (e.g. Bearer token). */
const SKIP_KEY_INJECTION = ["v1/auth/"]

/**
 * Only these request headers are forwarded upstream. Everything else
 * (cookies, client-supplied x-api-key, etc.) is stripped so a malicious or
 * buggy client can't leak console cookies to the sandbox API or override the
 * server-injected key.
 */
const FORWARD_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "authorization",
  "content-length",
  "content-type",
  "idempotency-key",
  "user-agent",
])

function isAllowedPath(path: string): boolean {
  if (isTeamBillingPath(path)) return true
  if (isStripeBillingPath(path)) return true
  return ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}

function shouldSkipKeyInjection(path: string): boolean {
  return SKIP_KEY_INJECTION.some((prefix) => path.startsWith(prefix))
}

function setImpersonationDebugHeaders(
  headers: Headers,
  debugEnabled: boolean,
  authMode: string,
  impersonatedTeamId: string | null,
): void {
  if (!debugEnabled) return
  headers.set("x-console-auth-mode", authMode)
  headers.set("x-console-impersonating", impersonatedTeamId ? "true" : "false")
  headers.set("x-console-impersonated-team", impersonatedTeamId ?? "")
}

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params
  const joinedPath = path.join("/")

  if (!isAllowedPath(joinedPath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const skipKeyInjection = shouldSkipKeyInjection(joinedPath)
  const debugImpersonation =
    request.nextUrl.searchParams.get("__debug_impersonation") === "1"
  let user: User | null = null
  let impersonationContext: { teamId: string; region: string } | null = null
  let impersonating = false

  if (!skipKeyInjection) {
    const supabase = await createServerClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    user = authUser
    impersonationContext = await getImpersonationContext(user)
    impersonating = impersonationContext !== null
    const isReadMethod = request.method === "GET" || request.method === "HEAD"
    if (impersonating && !isReadMethod) {
      return NextResponse.json(
        {
          error: {
            code: "read_only_impersonation",
            message:
              "Write operations are disabled while viewing another team.",
          },
        },
        { status: 403 },
      )
    }
  }

  const url = new URL(`${SANDBOX_API_URL}/${joinedPath}`)
  url.search = request.nextUrl.search
  url.searchParams.delete("__debug_impersonation")
  if (impersonating && impersonationContext) {
    url.searchParams.set("team_id", impersonationContext.teamId)
  }

  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const lowerKey = key.toLowerCase()
    if (!skipKeyInjection && lowerKey === "authorization") {
      continue
    }
    if (FORWARD_REQUEST_HEADERS.has(lowerKey)) {
      headers.set(lowerKey, value)
    }
  }

  // Paths that carry their own auth (no key injection) go to the default
  // cell; authenticated requests go to the user's team's home cell.
  let apiBaseUrl = cellFor(DEFAULT_REGION).apiBaseUrl

  // Inject server-side API key for authenticated requests
  let authMode = skipKeyInjection ? "skipped" : "none"
  if (!skipKeyInjection) {
    const apiKey = await getAuthApiKeyForUser(user, impersonationContext)

    if (!apiKey || !user) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Not authenticated" } },
        { status: 401 },
      )
    }
    headers.set("X-API-Key", apiKey)
    apiBaseUrl = impersonationContext
      ? cellFor(impersonationContext.region).apiBaseUrl
      : await getApiBaseUrlForUser(user)
    authMode = impersonating ? "impersonation" : "self"
  }

  const upstreamUrl = new URL(`${apiBaseUrl}/${joinedPath}`)
  upstreamUrl.search = url.search

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined

  const response = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body,
  })

  const responseHeaders = new Headers()
  for (const [key, value] of response.headers.entries()) {
    if (key === "transfer-encoding" || key === "content-encoding") {
      continue
    }
    responseHeaders.set(key, value)
  }
  if (joinedPath === "billing/summary") {
    responseHeaders.set("cache-control", "private, no-store")
  }
  setImpersonationDebugHeaders(
    responseHeaders,
    debugImpersonation,
    authMode,
    impersonationContext?.teamId ?? null,
  )

  // Per the Fetch spec, 204/205/304 responses must not have a body.
  // Next.js 16's NextResponse throws if you pass any body (even empty) for
  // these statuses, so we forward null and skip reading the upstream body.
  const isNullBodyStatus =
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304

  if (isNullBodyStatus) {
    return new NextResponse(null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  }

  // Stream Server-Sent Events through unbuffered. Buffering via
  // arrayBuffer() would make the browser wait for the build to finish
  // before seeing any log output.
  const upstreamContentType = response.headers.get("content-type") ?? ""
  if (upstreamContentType.includes("text/event-stream")) {
    if (impersonating) {
      return NextResponse.json(
        {
          error: {
            code: "streaming_disabled_during_impersonation",
            message:
              "Streaming responses are disabled while viewing another team.",
          },
        },
        { status: 403 },
      )
    }

    responseHeaders.set("cache-control", "no-cache, no-transform")
    responseHeaders.set("connection", "keep-alive")
    responseHeaders.set("x-accel-buffering", "no")
    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  }

  const data = await response.arrayBuffer()

  if (impersonating) {
    const contentType = responseHeaders.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      const redacted = redactAccessTokens(new TextDecoder().decode(data))
      const body = new TextEncoder().encode(redacted)
      responseHeaders.set("content-length", String(body.byteLength))
      return new NextResponse(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      })
    }
  }

  return new NextResponse(data, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export const GET = proxyRequest
export const POST = proxyRequest
export const PUT = proxyRequest
export const PATCH = proxyRequest
export const DELETE = proxyRequest
