"use server"

import * as z from "zod"

import { notifySlackOfNewUser } from "@/app/(auth)/auth/signin/action"
import { BLOCKED_TRIGGER_MESSAGE } from "@/lib/auth/errors"
import { sendEmail } from "@/lib/email/send"
import { ConfirmationEmail } from "@/lib/email/templates/confirmation"
import { WelcomeEmail } from "@/lib/email/templates/welcome"
import { createAdminClient } from "@/lib/supabase/admin"

const TURNSTILE_ACTION = "signup"

const signUpSchema = z.object({
  email: z.string().email("Invalid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().min(1, "Name is required.").max(200),
  turnstileToken: z.string().optional(),
})

type TurnstileVerification = {
  success: boolean
  hostname?: string
  action?: string
  "error-codes"?: string[]
}

async function verifyTurnstile(token: string | undefined) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  if (!secret && !siteKey) return { success: true as const }

  if (!secret || !siteKey) {
    console.error("Turnstile signup protection is only partially configured")
    return { success: false as const }
  }

  if (!token) return { success: false as const }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      cache: "no-store",
    },
  )

  if (!response.ok) {
    console.error("Turnstile verification request failed", {
      status: response.status,
    })
    return { success: false as const }
  }

  const verification = (await response.json()) as TurnstileVerification
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  let expectedHostname: string | undefined

  if (appUrl) {
    try {
      expectedHostname = new URL(appUrl).hostname
    } catch {
      console.error("NEXT_PUBLIC_APP_URL is invalid; cannot validate Turnstile hostname")
      return { success: false as const }
    }
  }

  const valid =
    verification.success &&
    verification.action === TURNSTILE_ACTION &&
    (!expectedHostname || verification.hostname === expectedHostname)

  if (!valid) {
    console.warn("Turnstile signup verification rejected", {
      action: verification.action,
      hostname: verification.hostname,
      errorCodes: verification["error-codes"],
    })
  }

  return { success: valid }
}

export const signUpWithEmail = async (
  email: string,
  password: string,
  fullName: string,
  turnstileToken?: string,
) => {
  const parsed = signUpSchema.safeParse({
    email,
    password,
    fullName,
    turnstileToken,
  })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  try {
    const turnstile = await verifyTurnstile(parsed.data.turnstileToken)
    if (!turnstile.success) {
      return {
        success: false,
        error: "Please complete the verification challenge and try again.",
        errorCode: "turnstile_failed" as const,
      }
    }

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
