import { NextResponse } from "next/server"

import { notifySlackOfNewUser } from "@/app/(auth)/auth/signin/action"
import {
  consumeFingerprintSignupEventId,
  scheduleFingerprintObservation,
  sendWelcomeEmail,
} from "@/app/(auth)/auth/signup/action"
import { listTeamMembershipsForUserDetailed } from "@/lib/api/team-directory"
import { BLOCKED_TRIGGER_MESSAGE } from "@/lib/auth/errors"
import { classifyGoogleMembershipState } from "@/lib/auth/google-onboarding"
import {
  hasValidGoogleSignupProof,
  isGoogleUser,
} from "@/lib/auth/google-signup-proof"
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
  let next = sanitizeNext(searchParams.get("next"))

  if (code || tokenHash) {
    const supabase = await createServerClient()
    let error = null
    if (code) {
      const result = await supabase.auth.exchangeCodeForSession(code)
      error = result.error
    } else if (tokenHash && type) {
      const result = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      })
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
        const provider = code
          ? user.app_metadata?.provider || "google"
          : "email"
        let isNewUser = false

        if (code && isGoogleUser(user)) {
          const directory = await classifyGoogleMembershipState(
            user.id,
            await listTeamMembershipsForUserDetailed(user.id, {
              maxAgeMs: 0,
            }),
          )

          if (directory.kind === "indeterminate") {
            await trackEvent(AUTH_EVENTS.SIGN_IN_FAILED, user.id, {
              provider,
              email: user.email,
              reason: "membership_lookup_degraded",
            })
            console.warn("Google OAuth membership lookup degraded", {
              provider,
              stage: "callback",
              degradedRegions: directory.degradedRegions,
            })
            return NextResponse.redirect(
              buildRedirectUrl(
                origin,
                "/auth/auth-code-error?reason=membership_lookup_degraded",
              ),
            )
          }

          isNewUser = directory.kind === "first_time"

          if (isNewUser) {
            const proofValid = await hasValidGoogleSignupProof()
            if (!proofValid) {
              await trackEvent(
                AUTH_EVENTS.GOOGLE_SIGNUP_BYPASS_BLOCKED,
                user.id,
                {
                  reason: "missing_or_invalid_proof",
                  provider,
                },
              )
              console.warn("Google OAuth onboarding blocked", {
                reason: "missing_or_invalid_proof",
              })
              const recoveryUrl = new URL("/auth/signup", origin)
              recoveryUrl.searchParams.set("complete_google", "1")
              if (next !== "/") recoveryUrl.searchParams.set("next", next)
              return NextResponse.redirect(
                buildRedirectUrl(
                  origin,
                  `${recoveryUrl.pathname}${recoveryUrl.search}`,
                ),
              )
            }
            console.info("Google OAuth signup proof validated at callback")
          }

          const fingerprintEventId = await consumeFingerprintSignupEventId()
          if (isNewUser) {
            scheduleFingerprintObservation(
              fingerprintEventId,
              "google",
              user.id,
            )
          }
        } else {
          const createdAt = new Date(user.created_at)
          isNewUser = Date.now() - createdAt.getTime() < 30000
        }

        if (isNewUser) {
          await notifySlackOfNewUser(
            user.email || "",
            user.user_metadata?.full_name || null,
            user.app_metadata?.provider || null,
          )
          Promise.resolve(
            sendWelcomeEmail(
              user.email || "",
              user.user_metadata?.full_name || "there",
            ),
          ).catch(() => {})
        }

        await trackEvent(
          isNewUser
            ? AUTH_EVENTS.SIGN_UP_COMPLETED
            : AUTH_EVENTS.SIGN_IN_COMPLETED,
          user.id,
          { provider, email: user.email, is_new_user: isNewUser },
        )

        if (!next.startsWith("/device") && !next.startsWith("https://")) {
          next = "/sandboxes"
        }
      }

      if (next.startsWith("https://")) return NextResponse.redirect(next)
      return NextResponse.redirect(buildRedirectUrl(origin, next))
    }
  }
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
