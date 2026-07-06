import { type NextRequest, NextResponse } from "next/server"

import { canViewOtherUsersAccount } from "@/lib/admin/permissions"
import { createServerClient } from "@/lib/supabase/server"

const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL ?? "https://api.superserve.ai"

function internalApiToken(): string | undefined {
  return process.env.SANDBOX_INTERNAL_API_TOKEN
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

function targetPath(teamId: string, path: string[]): string | null {
  if (path.length === 0) {
    return `/internal/teams/${encodeURIComponent(teamId)}/sandboxes`
  }
  if (path.length === 1) {
    return `/internal/teams/${encodeURIComponent(teamId)}/sandboxes/${encodeURIComponent(path[0])}`
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
  const token = internalApiToken()
  if (!token) {
    return NextResponse.json(
      {
        error: {
          code: "internal_api_not_configured",
          message: "Sandbox internal API token is not configured.",
        },
      },
      { status: 500 },
    )
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
  if (!canViewOtherUsersAccount(user)) {
    return notFound()
  }

  const teamId = request.nextUrl.searchParams.get("team_id")
  if (!teamId) {
    return badRequest("team_id is required")
  }

  const { path = [] } = await params
  const upstreamPath = targetPath(teamId, path)
  if (!upstreamPath) {
    return notFound()
  }

  const url = new URL(`${SANDBOX_API_URL}${upstreamPath}`)
  const response = await fetch(url.toString(), {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token}`,
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
