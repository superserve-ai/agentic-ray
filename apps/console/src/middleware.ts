import { type NextRequest, NextResponse } from "next/server"

import { createMiddlewareClient, matchesRoute } from "@/lib/supabase/middleware"

const PUBLIC_ROUTES = [
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/callback",
  "/auth/auth-code-error",
  "/device",
  "/.well-known/security.txt",
]

export async function middleware(request: NextRequest) {
  const client = createMiddlewareClient(request)
  if (!client.supabase) return client.response

  const {
    data: { user },
  } = await client.supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isPublicRoute = matchesRoute(pathname, PUBLIC_ROUTES)

  if (!user && !isPublicRoute) {
    const signinUrl = request.nextUrl.clone()
    signinUrl.pathname = "/auth/signin"
    signinUrl.searchParams.set("next", pathname)
    // Build the redirect on top of client.response so any refreshed Supabase
    // auth cookies (written by getUser() via setAll) survive the redirect.
    const redirect = NextResponse.redirect(signinUrl)
    for (const cookie of client.response.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    return redirect
  }

  return client.response
}

export const config = {
  matcher: [
    // Skip Next internals and common static assets so getUser() isn't called
    // on every font/css/js request. /api is skipped too: every API route
    // authenticates its own request (and answers JSON, not a redirect to the
    // signin page), so the middleware getUser() was a second Supabase auth
    // round-trip on every API call — including the 10s sandbox list poll.
    "/((?!api/|_next/static|_next/image|favicon\\.ico|\\.well-known/security\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|css|js|map)$).*)",
  ],
}
