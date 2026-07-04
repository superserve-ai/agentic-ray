import type { User } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"

import { impersonationTtlMs } from "@/lib/admin/impersonation"
import { deriveConsoleKey } from "@/lib/admin/impersonation-key"
import { canReadPlatformSandboxes } from "@/lib/admin/permissions"
import { hashKey } from "@/lib/api/proxy-secret"
import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL ?? "https://api.superserve.ai"
const PLATFORM_READ_KEY_NAME = "__console_platform_sandbox_read__"
const PLATFORM_READ_KEY_PURPOSE = "v1:platform-sandbox-read"
const platformReadKeyExpiryCache = new Map<string, number>()

async function ensurePlatformReadKey(
  user: User,
  teamId: string,
): Promise<string> {
  const rawKey = deriveConsoleKey(PLATFORM_READ_KEY_PURPOSE, user.id, teamId)
  const keyHash = hashKey(rawKey)
  const ttlMs = impersonationTtlMs()
  const now = Date.now()

  const cachedExpiry = platformReadKeyExpiryCache.get(keyHash)
  if (cachedExpiry !== undefined && cachedExpiry - now > ttlMs / 2) {
    return rawKey
  }

  const expiresAtMs = now + ttlMs
  const admin = createAdminClient()
  const { error } = await admin.from("api_key").upsert(
    {
      team_id: teamId,
      key_hash: keyHash,
      name: PLATFORM_READ_KEY_NAME,
      scopes: [],
      created_by: user.id,
      expires_at: new Date(expiresAtMs).toISOString(),
      revoked_at: null,
    },
    { onConflict: "key_hash" },
  )

  if (error) {
    throw new Error(
      `Failed to ensure platform sandbox read key: ${error.message}`,
    )
  }

  platformReadKeyExpiryCache.set(keyHash, expiresAtMs)
  return rawKey
}

type RouteContext = { params: Promise<{ path?: string[] }> }

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}

function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { error: { code: "bad_request", message } },
    { status: 400 },
  )
}

function targetPath(path: string[]): string | null {
  if (path.length === 0) {
    return "/sandboxes"
  }
  if (path.length === 1) {
    return `/sandboxes/${encodeURIComponent(path[0])}`
  }
  return null
}

async function proxyPlatformSandboxRead(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return notFound()
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not authenticated" } },
      { status: 401 },
    )
  }
  if (!canReadPlatformSandboxes(user)) {
    return notFound()
  }

  const teamId = request.nextUrl.searchParams.get("team_id")
  if (!teamId) {
    return badRequest("team_id is required")
  }

  const { path = [] } = await params
  const upstreamPath = targetPath(path)
  if (!upstreamPath) {
    return notFound()
  }

  const apiKey = await ensurePlatformReadKey(user, teamId)
  const url = new URL(`${SANDBOX_API_URL}${upstreamPath}`)
  const response = await fetch(url.toString(), {
    method: request.method,
    headers: {
      "X-API-Key": apiKey,
      "X-Actor-User-Id": user.id,
      Accept: request.headers.get("accept") ?? "application/json",
    },
  })

  const responseHeaders = new Headers()
  for (const [key, value] of response.headers.entries()) {
    if (key === "transfer-encoding" || key === "content-encoding") continue
    responseHeaders.set(key, value)
  }

  if (
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  ) {
    return new NextResponse(null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  }

  return new NextResponse(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export const GET = proxyPlatformSandboxRead
export const HEAD = proxyPlatformSandboxRead
