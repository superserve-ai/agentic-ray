import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

import { notifySlackOfNewUser } from "@/app/(auth)/auth/signin/action"
import { sendWelcomeEmail } from "@/app/(auth)/auth/signup/action"
import { BLOCKED_TRIGGER_MESSAGE } from "@/lib/auth/errors"

type CookieToSet = {
  name: string
  value: string
  options?: Record<string, unknown>
}

type CookieOptions = {
  domain?: string
  [key: string]: unknown
}

function isVercelPreviewHost(hostname: string): boolean {
  return hostname.endsWith(".vercel.app")
}

function buildRedirectUrl(origin: string, path: string): string {
  const base =
    process.env.VERCEL_ENV === "preview"
      ? origin
      : process.env.NEXT_PUBLIC_APP_URL || origin

  return new URL(path, base).toString()
}

function buildRedirectResponse(
  targetUrl: string,
  cookiesToSet: CookieToSet[],
  domainOpts: CookieOptions = {},
): NextResponse {
  const response = NextResponse.redirect(targetUrl)
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, { ...options, ...domainOpts })
  }
  return response
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as
    | "signup"
    | "recovery"
    | "invite"
    | "magiclink"
    | "email"
    | null

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
  }

  const cookiesToSet: CookieToSet[] = []
  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN
  const domainOpts =
    cookieDomain && !isVercelPreviewHost(request.nextUrl.hostname)
      ? { domain: cookieDomain }
      : {}

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    )
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookies) {
        cookiesToSet.push(...cookies)
      },
    },
  })

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  })

  if (error) {
    const blocked = error.message
      .toLowerCase()
      .includes(BLOCKED_TRIGGER_MESSAGE)
    if (blocked) {
      console.warn("Signup blocked by trigger")
      return buildRedirectResponse(
        buildRedirectUrl(origin, "/auth/auth-code-error?reason=signup_blocked"),
        cookiesToSet,
        domainOpts,
      )
    }

    console.error("Auth confirmation error:", error.message, {
      tokenHash: true,
      type,
    })

    return buildRedirectResponse(
      buildRedirectUrl(origin, "/auth/auth-code-error"),
      cookiesToSet,
      domainOpts,
    )
  }

  if (type === "recovery") {
    return buildRedirectResponse(
      buildRedirectUrl(origin, "/auth/reset-password"),
      cookiesToSet,
      domainOpts,
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user && type === "signup") {
    const createdAt = new Date(user.created_at)
    const now = new Date()
    const isNewUser = now.getTime() - createdAt.getTime() < 30000

    if (isNewUser) {
      await notifySlackOfNewUser(
        user.email || "",
        user.user_metadata?.full_name || null,
        user.app_metadata?.provider || null,
      )
      sendWelcomeEmail(
        user.email || "",
        user.user_metadata?.full_name || "there",
      ).catch(() => {})
    }
  }

  return buildRedirectResponse(
    buildRedirectUrl(origin, "/sandboxes?confirmed=email"),
    cookiesToSet,
    domainOpts,
  )
}
