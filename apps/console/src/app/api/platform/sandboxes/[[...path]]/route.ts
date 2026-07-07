import { type NextRequest, NextResponse } from "next/server"

import { canReadPlatformSandboxes } from "@/lib/admin/permissions"
import { getProxySecret } from "@/lib/api/proxy-secret"
import { createServerClient } from "@/lib/supabase/server"

const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL ?? "https://api.superserve.ai"
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    return "sandboxes"
  }
  if (path.length === 1) {
    return `sandboxes/${encodeURIComponent(path[0])}`
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
  if (!UUID_RE.test(teamId)) {
    return badRequest("Invalid team_id")
  }

  const { path = [] } = await params
  const upstreamPath = targetPath(path)
  if (!upstreamPath) {
    return notFound()
  }

  const internalSecret = getProxySecret()
  const url = new URL(
    `${SANDBOX_API_URL}/internal/teams/${encodeURIComponent(teamId)}/${upstreamPath}`,
  )
  const response = await fetch(url.toString(), {
    method: request.method,
    headers: {
      Accept: request.headers.get("accept") ?? "application/json",
      Authorization: `Bearer ${internalSecret}`,
      "X-Actor-User-Id": user.id,
      "X-Internal-Secret": internalSecret,
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
