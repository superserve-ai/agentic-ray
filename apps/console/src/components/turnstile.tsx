"use client"

import Script from "next/script"
import { useEffect, useRef, useState } from "react"

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      action?: string
      callback: (token: string) => void
      "error-callback"?: () => void
      "expired-callback"?: () => void
      theme?: "light" | "dark" | "auto"
    },
  ) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

type TurnstileProps = {
  siteKey: string
  action: string
  resetKey: number
  onToken: (token: string | null) => void
}

export function Turnstile({
  siteKey,
  action,
  resetKey,
  onToken,
}: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [scriptReady, setScriptReady] = useState(false)

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile) return

    if (widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current)
      widgetIdRef.current = null
    }

    onToken(null)
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action,
      theme: "auto",
      callback: (token) => onToken(token),
      "expired-callback": () => onToken(null),
      "error-callback": () => onToken(null),
    })

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [action, onToken, resetKey, scriptReady, siteKey])

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={containerRef} className="flex min-h-[65px] justify-center" />
    </>
  )
}
