"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useEffect } from "react"

import { AUTH_EVENTS } from "@/lib/posthog/events"

const CONFIRMATION_TRACKING_KEY = "superserve:auth-confirmation-tracked"

export function AuthConfirmationTracker() {
  const posthog = usePostHog()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const confirmationSource = searchParams.get("confirmed")

  useEffect(() => {
    if (confirmationSource !== "email") return

    try {
      if (window.sessionStorage.getItem(CONFIRMATION_TRACKING_KEY) !== "1") {
        posthog?.capture(AUTH_EVENTS.SIGN_IN_COMPLETED, { method: "email" })
        window.sessionStorage.setItem(CONFIRMATION_TRACKING_KEY, "1")
      }
    } catch {
      // If storage is unavailable, still strip the landing query param.
    }

    const next = new URLSearchParams(searchParams.toString())
    next.delete("confirmed")
    const nextUrl = next.toString()
      ? `${pathname}?${next.toString()}`
      : pathname
    router.replace(nextUrl)
  }, [confirmationSource, pathname, posthog, router, searchParams])

  return null
}
