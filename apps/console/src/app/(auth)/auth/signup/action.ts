"use server"

import crypto from "node:crypto"

import { cookies } from "next/headers"
import { headers } from "next/headers"
import { after } from "next/server"
import * as z from "zod"

import { notifySlackOfNewUser } from "@/app/(auth)/auth/signin/action"
import { BLOCKED_TRIGGER_MESSAGE } from "@/lib/auth/errors"
import { issueGoogleSignupProof } from "@/lib/auth/google-signup-proof"
import {
  isCloudflareSignupObservationEnabled as readCloudflareObservationFlag,
  observeCloudflareSignup,
} from "@/lib/cloudflare/signup-observe"
import { sendEmail } from "@/lib/email/send"
import { ConfirmationEmail } from "@/lib/email/templates/confirmation"
import { WelcomeEmail } from "@/lib/email/templates/welcome"
import { FINGERPRINT_SIGNUP_COOKIE } from "@/lib/fingerprint/constants"
import { observeFingerprintSignup } from "@/lib/fingerprint/observe"
import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { verifyRecaptcha } from "@/lib/recaptcha/verify"
import { createAdminClient } from "@/lib/supabase/admin"

const signUpSchema = z.object({
  email: z.string().email("Invalid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().min(1, "Name is required.").max(200),
})

export async function isCloudflareSignupObservationEnabled(): Promise<boolean> {
  return Promise.race([
    readCloudflareObservationFlag(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 750)),
  ])
}

export async function scheduleCloudflareObservation(
  signupAttemptId: string,
  signupMethod: "email" | "google",
  userId?: string | null,
  teamId?: string | null,
  clientContext?: {
    userAgent?: string | null
    ip?: string | null
    ray?: string | null
  },
  turnstileToken?: string | null,
) {
  try {
    after(() =>
      observeCloudflareSignup({
        signupAttemptId,
        signupMethod,
        userId,
        teamId,
        clientContext,
        turnstileToken,
      }),
    )
  } catch {
    // Cloudflare is strictly telemetry-only.
  }
}

async function readCloudflareClientContext() {
  try {
    const requestHeaders = await headers()
    return {
      userAgent: requestHeaders.get("user-agent"),
      ip:
        requestHeaders.get("cf-connecting-ip") ||
        requestHeaders.get("x-forwarded-for"),
      ray: requestHeaders.get("cf-ray"),
    }
  } catch {
    return undefined
  }
}

export async function readFingerprintSignupEventId(): Promise<
  string | undefined
> {
  try {
    const store = await cookies()
    const encodedEventId = store.get(FINGERPRINT_SIGNUP_COOKIE)?.value
    if (!encodedEventId) return undefined

    try {
      return decodeURIComponent(encodedEventId)
    } catch {
      return undefined
    }
  } catch {
    return undefined
  }
}

export async function consumeFingerprintSignupEventId(): Promise<
  string | undefined
> {
  const eventId = await readFingerprintSignupEventId()
  if (!eventId) return undefined

  try {
    const store = await cookies()
    store.delete(FINGERPRINT_SIGNUP_COOKIE)
  } catch {
    // Cookie cleanup is telemetry-only and must remain fail open.
  }
  return eventId
}

export async function scheduleFingerprintObservation(
  eventId: string | undefined,
  signupMethod: "email" | "google",
  userId?: string | null,
  signupAttemptId?: string,
) {
  if (!eventId) return
  try {
    after(() =>
      observeFingerprintSignup({
        eventId,
        signupMethod,
        ...(userId !== undefined ? { userId } : {}),
        ...(signupAttemptId ? { signupAttemptId } : {}),
      }),
    )
  } catch (error) {
    // Scheduling is telemetry-only; an unavailable request lifecycle hook
    // must never change signup behavior.
    console.warn("Fingerprint observation scheduling failed open", {
      eventId,
      error: error instanceof Error ? error.message : "unknown_error",
    })
  }
}

export const beginGoogleSignup = async (
  recaptchaToken?: string,
  turnstileToken?: string,
): Promise<
  | { success: true; signupAttemptId: string }
  | {
      success: false
      error: string
      errorCode: "captcha_failed" | "proof_unavailable"
    }
> => {
  const signupAttemptId = crypto.randomUUID()
  const clientContext = await readCloudflareClientContext()
  const fingerprintEventId = await readFingerprintSignupEventId()
  scheduleCloudflareObservation(
    signupAttemptId,
    "google",
    undefined,
    undefined,
    clientContext,
    turnstileToken,
  )
  const recaptcha = await verifyRecaptcha(recaptchaToken, "signup_google")
  await trackEvent(AUTH_EVENTS.SIGNUP_RECAPTCHA_OBSERVED, signupAttemptId, {
    provider: "recaptcha",
    signup_attempt_id: signupAttemptId,
    signup_method: "google",
    verified: recaptcha.verified,
    provider_outcome: recaptcha.providerOutcome,
    reason: "reason" in recaptcha ? recaptcha.reason : null,
    score: recaptcha.score,
    recaptcha_assessment_id: recaptcha.assessmentId ?? null,
    recaptcha_risk_reasons: recaptcha.riskReasons ?? [],
    observed_at: new Date().toISOString(),
  })
  if (!recaptcha.verified) {
    await scheduleFingerprintObservation(
      fingerprintEventId,
      "google",
      null,
      signupAttemptId,
    )
    await trackEvent(
      AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_FAILED,
      signupAttemptId,
      {
        reason: recaptcha.reason,
        stage: "captcha_verification",
      },
    )
    console.warn("Google signup blocked by reCAPTCHA", {
      reason: recaptcha.reason,
    })
    return {
      success: false,
      error: "We couldn't verify you're human. Please try again.",
      errorCode: "captcha_failed" as const,
    }
  }

  try {
    await issueGoogleSignupProof(signupAttemptId)
    await trackEvent(
      AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_VERIFIED,
      signupAttemptId,
      {
        stage: "captcha_verification",
      },
    )
    console.info("Google signup CAPTCHA verified; pre-auth proof issued")
    return { success: true, signupAttemptId }
  } catch (error) {
    await trackEvent(
      AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_FAILED,
      signupAttemptId,
      {
        reason:
          error instanceof Error ? error.message : "proof_issuance_failed",
        stage: "proof_issuance",
      },
    )
    console.error("Google signup proof issuance failed", error)
    return {
      success: false,
      error: "Google signup is temporarily unavailable. Please try again.",
      errorCode: "proof_unavailable" as const,
    }
  }
}

export const signUpWithEmail = async (
  email: string,
  password: string,
  fullName: string,
  recaptchaToken?: string,
  turnstileToken?: string,
) => {
  const parsed = signUpSchema.safeParse({ email, password, fullName })
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0].message }

  const signupAttemptId = crypto.randomUUID()
  const clientContext = await readCloudflareClientContext()
  const fingerprintEventId = await readFingerprintSignupEventId()
  scheduleCloudflareObservation(
    signupAttemptId,
    "email",
    undefined,
    undefined,
    clientContext,
    turnstileToken,
  )
  let fingerprintObservationScheduled = false
  const emitFingerprintObservation = (userId?: string | null) => {
    if (!fingerprintEventId || fingerprintObservationScheduled) return
    fingerprintObservationScheduled = true
    scheduleFingerprintObservation(
      fingerprintEventId,
      "email",
      userId,
      signupAttemptId,
    )
  }

  const recaptcha = await verifyRecaptcha(recaptchaToken, "signup")
  await trackEvent(AUTH_EVENTS.SIGNUP_RECAPTCHA_OBSERVED, signupAttemptId, {
    provider: "recaptcha",
    signup_attempt_id: signupAttemptId,
    signup_method: "email",
    verified: recaptcha.verified,
    provider_outcome: recaptcha.providerOutcome,
    reason: "reason" in recaptcha ? recaptcha.reason : null,
    score: recaptcha.score,
    recaptcha_assessment_id: recaptcha.assessmentId ?? null,
    recaptcha_risk_reasons: recaptcha.riskReasons ?? [],
    observed_at: new Date().toISOString(),
  })
  if (!recaptcha.verified) {
    emitFingerprintObservation()
    console.warn("Signup blocked by reCAPTCHA", {
      email: parsed.data.email,
      reason: recaptcha.reason,
    })
    return {
      success: false,
      error: "We couldn't verify you're human. Please try again.",
      errorCode: "captcha_failed" as const,
    }
  }

  try {
    const supabase = createAdminClient()
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
    const redirectTo = `${appUrl}/auth/callback`
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "signup",
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.fullName }, redirectTo },
    })

    if (error) {
      emitFingerprintObservation()
      if (error.message.includes("already registered")) {
        return {
          success: false,
          error: "An account with this email already exists.",
        }
      }
      if (error.message.toLowerCase().includes(BLOCKED_TRIGGER_MESSAGE)) {
        console.warn("Signup blocked by trigger", { email: parsed.data.email })
        return {
          success: false,
          error: "Signup is not available for this email address.",
          errorCode: "blocked_email" as const,
        }
      }
      return { success: false, error: error.message }
    }

    emitFingerprintObservation(data?.user?.id ?? null)
    await trackEvent(
      AUTH_EVENTS.SIGNUP_ATTEMPT_ASSOCIATED,
      data?.user?.id || signupAttemptId,
      {
        signup_attempt_id: signupAttemptId,
        superserve_user_id: data?.user?.id ?? null,
        signup_method: "email",
        observed_at: new Date().toISOString(),
      },
    )

    const tokenHash = data?.properties?.hashed_token
    if (!tokenHash)
      return { success: false, error: "Failed to generate confirmation link." }

    const confirmationUrl = `${redirectTo}?token_hash=${tokenHash}&type=signup&utm_source=email&utm_medium=signup_confirmation`
    await sendEmail({
      to: parsed.data.email,
      subject: "Confirm your Superserve account",
      react: ConfirmationEmail({ confirmationUrl }),
    })
    notifySlackOfNewUser(
      parsed.data.email,
      parsed.data.fullName,
      "email",
    ).catch(() => {})
    return { success: true }
  } catch (err) {
    emitFingerprintObservation()
    console.error("Signup error:", err)
    return {
      success: false,
      error: "Error creating account. Please try again.",
    }
  }
}

export const sendWelcomeEmail = async (email: string, name: string) => {
  try {
    const baseDashboardUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
    const dashboardUrl = `${baseDashboardUrl}?utm_source=email&utm_medium=welcome`
    await sendEmail({
      to: email,
      subject: "Welcome to Superserve!",
      react: WelcomeEmail({ name: name || "there", dashboardUrl }),
    })
  } catch (error) {
    console.error("Error sending welcome email:", error)
  }
}
