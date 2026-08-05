import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

export function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  )
}

function isVercelPreviewHost(hostname: string): boolean {
  return hostname.endsWith(".vercel.app")
}

export function createMiddlewareClient(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    return {
      supabase: null,
      get response() {
        return response
      },
    }
  }

  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN
  const hostname = request.nextUrl?.hostname ?? ""
  const domainOpts =
    cookieDomain && !isVercelPreviewHost(hostname)
      ? { domain: cookieDomain }
      : {}

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set({
            name,
            value,
            ...domainOpts,
          } as { name: string; value: string })
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, { ...options, ...domainOpts })
        }
      },
    },
  })

  return {
    supabase,
    get response() {
      return response
    },
  }
}
