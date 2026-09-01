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
import { ensureFingerprintSignupEventId } from "@/lib/fingerprint/client"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createBrowserClient } from "@/lib/supabase/client"

import {
  beginGoogleSignup,
  isCloudflareSignupObservationEnabled,
  signUpWithEmail,
} from "./action"

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
const TRUSTED_REDIRECT_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)?superserve\.ai(\/.*)?$/
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY

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
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
    }
  }
}

const TURNSTILE_LOAD_TIMEOUT_MS = 1500
const TURNSTILE_TOKEN_TIMEOUT_MS = 3000

const getTurnstileToken = async (): Promise<string | undefined> => {
  if (!TURNSTILE_SITE_KEY) return undefined
  const start = Date.now()
  while (!window.turnstile && Date.now() - start < TURNSTILE_LOAD_TIMEOUT_MS)
    await new Promise((resolve) => setTimeout(resolve, 100))
  if (!window.turnstile) return undefined
  return new Promise((resolve) => {
    const container = document.createElement("div")
    container.style.position = "fixed"
    container.style.bottom = "16px"
    container.style.right = "16px"
    container.style.zIndex = "50"
    document.body.appendChild(container)
    let widgetId = ""
    const cleanup = () => {
      if (widgetId) window.turnstile?.remove(widgetId)
      container.remove()
    }
    const deadline = setTimeout(() => {
      cleanup()
      resolve(undefined)
    }, TURNSTILE_TOKEN_TIMEOUT_MS)
    try {
      widgetId = window.turnstile!.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        size: "compact",
        appearance: "interaction-only",
        callback: (token: string) => {
          clearTimeout(deadline)
          cleanup()
          resolve(token)
        },
        "error-callback": () => {
          clearTimeout(deadline)
          cleanup()
          resolve(undefined)
        },
        "timeout-callback": () => {
          clearTimeout(deadline)
          cleanup()
          resolve(undefined)
        },
      })
    } catch {
      clearTimeout(deadline)
      cleanup()
      resolve(undefined)
    }
  })
}

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

function sanitizeNext(raw: string | null): string {
  const next = raw ?? "/"
  if (next.startsWith("/") && !next.startsWith("//")) return next
  if (TRUSTED_REDIRECT_PATTERN.test(next)) return next
  return "/"
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
  const nextUrl = sanitizeNext(searchParams.get("next"))
  const isCompleteGoogleSignup = searchParams.get("complete_google") === "1"

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
      void ensureFingerprintSignupEventId()
      const recaptchaToken = await getRecaptchaToken("signup")
      const turnstileEnabled = await isCloudflareSignupObservationEnabled()
      const turnstileToken = turnstileEnabled
        ? await getTurnstileToken()
        : undefined
      if (RECAPTCHA_SITE_KEY && !recaptchaToken) {
        setErrors({
          form: "We couldn't load our bot-check. If you're using a content or ad blocker, please disable it for this site and try again.",
        })
        return
      }
      const result = turnstileToken
        ? await signUpWithEmail(
            email,
            password,
            fullName,
            recaptchaToken,
            turnstileToken,
          )
        : await signUpWithEmail(email, password, fullName, recaptchaToken)
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
      void ensureFingerprintSignupEventId()
      const recaptchaToken = await getRecaptchaToken("signup_google")
      const turnstileEnabled = await isCloudflareSignupObservationEnabled()
      const turnstileToken = turnstileEnabled
        ? await getTurnstileToken()
        : undefined
      if (RECAPTCHA_SITE_KEY && !recaptchaToken) {
        setErrors({
          form: "We couldn't load our bot-check. If you're using a content or ad blocker, please disable it for this site and try again.",
        })
        return
      }

      const proof = turnstileToken
        ? await beginGoogleSignup(recaptchaToken, turnstileToken)
        : await beginGoogleSignup(recaptchaToken)
      if (!proof.success) {
        setErrors({ form: proof.error || "Google signup verification failed." })
        return
      }

      const supabase = createBrowserClient()
      const callbackUrl = new URL("/auth/callback", window.location.origin)
      callbackUrl.searchParams.set("signup_attempt_id", proof.signupAttemptId)
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
      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
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
        ) : isCompleteGoogleSignup ? (
          <>
            <h1 className="mb-4 text-center text-sm font-medium text-foreground">
              Complete signup
            </h1>
            <p className="mb-6 text-center text-xs leading-relaxed text-muted">
              Google sign-in succeeded. Complete signup to finish verification
              and provision your Superserve account.
            </p>
            {errors.form && (
              <p className="mb-4 text-xs text-destructive">{errors.form}</p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading || isLoading}
              className="w-full gap-2 border-solid font-sans tracking-normal normal-case"
            >
              {isGoogleLoading ? <Spinner /> : <GoogleIcon />}
              {isGoogleLoading
                ? "Completing signup..."
                : "Complete signup with Google"}
            </Button>
          </>
        ) : (
          <>
            <h1 className="mb-6 text-center text-sm font-medium text-foreground">
              Create your Superserve account
            </h1>
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
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-dashed border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface px-3 text-muted">or</span>
              </div>
            </div>
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
