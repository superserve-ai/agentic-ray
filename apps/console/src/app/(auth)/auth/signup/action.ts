"use server"

import crypto from "node:crypto"

import * as z from "zod"

import { notifySlackOfNewUser } from "@/app/(auth)/auth/signin/action"
import { BLOCKED_TRIGGER_MESSAGE } from "@/lib/auth/errors"
import { issueGoogleSignupProof } from "@/lib/auth/google-signup-proof"
import { sendEmail } from "@/lib/email/send"
import { ConfirmationEmail } from "@/lib/email/templates/confirmation"
import { WelcomeEmail } from "@/lib/email/templates/welcome"
import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { verifyRecaptcha } from "@/lib/recaptcha/verify"
import { createAdminClient } from "@/lib/supabase/admin"

const signUpSchema = z.object({
  email: z.string().email("Invalid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().min(1, "Name is required.").max(200),
})

export const beginGoogleSignup = async (recaptchaToken?: string) => {
  const distinctId = crypto.randomUUID()
  const recaptcha = await verifyRecaptcha(recaptchaToken, "signup_google")
  if (!recaptcha.verified) {
    await trackEvent(AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_FAILED, distinctId, {
      reason: recaptcha.reason,
      stage: "captcha_verification",
    })
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
    await issueGoogleSignupProof()
    await trackEvent(AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_VERIFIED, distinctId, {
      stage: "captcha_verification",
    })
    console.info("Google signup CAPTCHA verified; pre-auth proof issued")
    return { success: true }
  } catch (error) {
    await trackEvent(AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_FAILED, distinctId, {
      reason: error instanceof Error ? error.message : "proof_issuance_failed",
      stage: "proof_issuance",
    })
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
) => {
  const parsed = signUpSchema.safeParse({ email, password, fullName })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const recaptcha = await verifyRecaptcha(recaptchaToken, "signup")
  if (!recaptcha.verified) {
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
      options: {
        data: { full_name: parsed.data.fullName },
        redirectTo,
      },
    })

    if (error) {
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

    const tokenHash = data?.properties?.hashed_token
    if (!tokenHash) {
      return { success: false, error: "Failed to generate confirmation link." }
    }

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
