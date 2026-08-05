import { NextResponse } from "next/server"

import { notifySlackOfNewUser } from "@/app/(auth)/auth/signin/action"
import { sendWelcomeEmail } from "@/app/(auth)/auth/signup/action"
import { BLOCKED_TRIGGER_MESSAGE } from "@/lib/auth/errors"
import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createServerClient } from "@/lib/supabase/server"

const TRUSTED_REDIRECT_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)?superserve\.ai(\/.*)?$/

function buildRedirectUrl(origin: string, path: string): string {
  const base =
    process.env.VERCEL_ENV === "preview"
      ? origin
      : process.env.NEXT_PUBLIC_APP_URL || origin

  return new URL(path, base).toString()
}

function sanitizeNext(raw: string | null): string {
  const next = raw ?? "/"
  if (next.startsWith("/") && !next.startsWith("//")) return next
  if (TRUSTED_REDIRECT_PATTERN.test(next)) return next
  return "/"
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as
    | "signup"
    | "recovery"
    | "invite"
    | "magiclink"
    | "email"
    | null
  const rawNext = searchParams.get("next")
  const trustedAbsoluteNext =
    rawNext && TRUSTED_REDIRECT_PATTERN.test(rawNext) ? rawNext : null
  let next = sanitizeNext(rawNext)

  if (code || tokenHash) {
    if (tokenHash) {
      const confirmUrl = new URL("/auth/confirm", origin)
      confirmUrl.search = searchParams.toString()
      return NextResponse.redirect(confirmUrl)
    }

    const supabase = await createServerClient()

    let error = null
    if (code) {
      const result = await supabase.auth.exchangeCodeForSession(code)
      error = result.error
    }

    if (error) {
      const blocked = error.message
        .toLowerCase()
        .includes(BLOCKED_TRIGGER_MESSAGE)
      if (blocked) {
        console.warn("OAuth signup blocked by trigger")
        return NextResponse.redirect(
          buildRedirectUrl(
            origin,
            "/auth/auth-code-error?reason=signup_blocked",
          ),
        )
      }
      console.error("Auth callback error:", error.message, {
        code: !!code,
        tokenHash: !!tokenHash,
        type,
      })
    }

    if (!error) {
      if (next === "/auth/reset-password" || type === "recovery") {
        return NextResponse.redirect(
          buildRedirectUrl(origin, "/auth/reset-password"),
        )
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const createdAt = new Date(user.created_at)
        const now = new Date()
        const isNewUser = now.getTime() - createdAt.getTime() < 30000
        const provider = code
          ? user.app_metadata?.provider || "google"
          : "email"
        const sideEffects = [
          trackEvent(
            isNewUser
              ? AUTH_EVENTS.SIGN_UP_COMPLETED
              : AUTH_EVENTS.SIGN_IN_COMPLETED,
            user.id,
            { provider, email: user.email, is_new_user: isNewUser },
          ),
        ]

        if (isNewUser) {
          sideEffects.push(
            notifySlackOfNewUser(
              user.email || "",
              user.user_metadata?.full_name || null,
              user.app_metadata?.provider || null,
            ),
          )
          sideEffects.push(
            sendWelcomeEmail(
              user.email || "",
              user.user_metadata?.full_name || "there",
            ),
          )
        }

        await Promise.allSettled(sideEffects)

        if (!trustedAbsoluteNext && !next.startsWith("/device")) {
          next = "/sandboxes"
        }
      }

      if (trustedAbsoluteNext) {
        return NextResponse.redirect(trustedAbsoluteNext)
      }

      if (next.startsWith("https://")) {
        return NextResponse.redirect(next)
      }

      return NextResponse.redirect(buildRedirectUrl(origin, next))
    }
  }
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
