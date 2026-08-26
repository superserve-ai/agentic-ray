"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { Button, Input } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import Script from "next/script"
import { usePostHog } from "posthog-js/react"
import { Suspense, useEffect, useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import { GoogleIcon, Spinner } from "@/components/icons"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createBrowserClient } from "@/lib/supabase/client"

import { signUpWithEmail } from "./action"

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

declare global {
  interface Window {
    grecaptcha?: {
      enterprise: {
        ready: (callback: () => void) => void
        execute: (
          siteKey: string,
          options: { action: string },
        ) => Promise<string>
      }
    }
  }
}

// The script loads with strategy="afterInteractive", so a user who submits
// immediately (e.g. autofill + fast Enter) can beat it. Poll briefly rather
// than bailing on the first check, since verify.ts hard-rejects a configured
// key with no token — bailing too early would false-positive real users.
const waitForGrecaptcha = async (timeoutMs = 8000): Promise<boolean> => {
  if (window.grecaptcha) return true
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (window.grecaptcha) return true
  }
  return false
}

const RECAPTCHA_EXECUTE_TIMEOUT_MS = 8000

// A missing site key means the token is never requested and the server
// fails open (reCAPTCHA isn't configured). But if a site key IS configured
// and this still returns undefined — script blocked, timed out, or execute()
// failed — verify.ts hard-rejects the missing token rather than failing
// open, since that's also exactly what a scripted signup bypassing the
// browser widget looks like. handleSignUp below surfaces that case with an
// actionable message instead of the generic server rejection.
const getRecaptchaToken = async (
  action: string,
): Promise<string | undefined> => {
  if (!RECAPTCHA_SITE_KEY) return undefined
  if (!(await waitForGrecaptcha())) return undefined
  try {
    const tokenPromise = new Promise<string>((resolve, reject) => {
      window.grecaptcha!.enterprise.ready(() => {
        window
          .grecaptcha!.enterprise.execute(RECAPTCHA_SITE_KEY, { action })
          .then(resolve)
          .catch(reject)
      })
    })
    // ready()/execute() have no built-in deadline — during a partial Google
    // outage they can hang indefinitely and stall the signup form.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("recaptcha_execute_timeout")),
        RECAPTCHA_EXECUTE_TIMEOUT_MS,
      ),
    )
    return await Promise.race([tokenPromise, timeoutPromise])
  } catch {
    return undefined
  }
}

function SignUpContent() {
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const posthog = usePostHog()
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawNext = searchParams.get("next") || "/"
  const nextUrl = rawNext.startsWith("/") ? rawNext : "/"

  useEffect(() => {
    if (searchParams.get("error") === "link_expired") {
      setErrors({ form: "Verification link expired or invalid." })
    }
  }, [searchParams])

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    const newErrors: Record<string, string> = {}
    if (!fullName) newErrors.fullName = "Name is required."
    if (!email) newErrors.email = "Email is required."
    if (!password) newErrors.password = "Password is required."
    else if (password.length < 8)
      newErrors.password = "Must be at least 8 characters."
    if (password && password !== confirmPassword)
      newErrors.confirmPassword = "Passwords do not match."
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    setIsLoading(true)
    try {
      const recaptchaToken = await getRecaptchaToken("signup")
      if (RECAPTCHA_SITE_KEY && !recaptchaToken) {
        setErrors({
          form: "We couldn't load our bot-check. If you're using a content or ad blocker, please disable it for this site and try again.",
        })
        return
      }
      const result = await signUpWithEmail(
        email,
        password,
        fullName,
        recaptchaToken,
      )
      if (!result.success) {
        posthog.capture(AUTH_EVENTS.SIGN_UP_FAILED, {
          method: "email",
          reason: result.error,
        })
        if ("errorCode" in result && result.errorCode === "blocked_email") {
          router.push("/auth/auth-code-error?reason=signup_blocked")
          return
        }
        setErrors({ form: result.error || "Error creating account." })
        return
      }
      posthog.capture(AUTH_EVENTS.SIGN_UP_COMPLETED, { method: "email" })
      setEmailSent(true)
    } catch {
      setErrors({ form: "Error creating account. Please try again." })
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true)
    setErrors({})
    try {
      const supabase = createBrowserClient()
      const callbackUrl = new URL("/auth/callback", window.location.origin)
      if (nextUrl && nextUrl !== "/") {
        callbackUrl.searchParams.set("next", nextUrl)
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      })
      if (error) {
        setErrors({ form: "Error signing in. Please try again." })
      }
    } catch {
      setErrors({ form: "Error signing in. Please try again." })
    } finally {
      setIsGoogleLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      {RECAPTCHA_SITE_KEY && (
        <Script
          src={`https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`}
          strategy="afterInteractive"
        />
      )}
      <DitherBackground />
      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
        <CornerBrackets size="lg" />

        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image
              src="/logo.svg"
              alt="Superserve"
              width={120}
              height={24}
              className="h-6 w-auto"
            />
          </Link>
        </div>

        {emailSent ? (
          <>
            <h1 className="text-center text-sm font-medium text-foreground">
              Check Your Email
            </h1>
            <p className="mt-2 text-center text-xs leading-relaxed text-muted">
              We&apos;ve sent a verification link to{" "}
              <strong className="text-foreground">{email}</strong>. Check your
              inbox and click the link to verify your account.
            </p>
            <p className="mt-5 text-center text-xs text-muted">
              Already verified?{" "}
              <Link
                href="/auth/signin"
                className="font-medium text-foreground hover:underline"
              >
                Sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-6 text-center text-sm font-medium text-foreground">
              Create your Superserve account
            </h1>

            {/* Google OAuth — first */}
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading || isLoading}
              className="w-full gap-2 border-solid font-sans tracking-normal normal-case"
            >
              {isGoogleLoading ? <Spinner /> : <GoogleIcon />}
              {isGoogleLoading ? "Signing up..." : "Continue with Google"}
            </Button>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-dashed border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface px-3 text-muted">or</span>
              </div>
            </div>

            {/* Sign up form */}
            <form onSubmit={handleSignUp} className="space-y-3">
              <Input
                type="text"
                placeholder="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                error={errors.fullName}
              />
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
              />
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-muted"
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="size-4" weight="light" />
                    ) : (
                      <EyeIcon className="size-4" weight="light" />
                    )}
                  </button>
                }
              />
              <Input
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                error={errors.confirmPassword}
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-muted"
                  >
                    {showConfirmPassword ? (
                      <EyeSlashIcon className="size-4" weight="light" />
                    ) : (
                      <EyeIcon className="size-4" weight="light" />
                    )}
                  </button>
                }
              />
              {errors.form && (
                <p className="text-xs text-destructive">{errors.form}</p>
              )}
              <Button
                type="submit"
                disabled={isLoading || isGoogleLoading}
                className="w-full"
              >
                {isLoading ? <Spinner /> : null}
                {isLoading ? "Creating account..." : "Sign Up"}
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-muted">
              Already have an account?{" "}
              <Link
                href="/auth/signin"
                className="font-medium text-foreground hover:underline"
              >
                Sign in
              </Link>
            </p>

            <p className="mt-6 text-center text-xs leading-relaxed text-muted/60">
              By continuing, you agree to our{" "}
              <a
                href={`${process.env.NEXT_PUBLIC_WEBSITE_URL}/privacy`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline-offset-2 hover:underline"
              >
                Privacy Policy
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <SignUpContent />
    </Suspense>
  )
}
