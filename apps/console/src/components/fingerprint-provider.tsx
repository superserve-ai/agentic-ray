"use client"

import { FingerprintProvider as Provider } from "@fingerprint/react"
import type React from "react"

const apiKey = process.env.NEXT_PUBLIC_FINGERPRINT_API_KEY
const configuredRegion = process.env.NEXT_PUBLIC_FINGERPRINT_REGION
const region =
  configuredRegion === "eu" || configuredRegion === "ap"
    ? configuredRegion
    : "us"

export function FingerprintProvider({
  children,
}: {
  children: React.ReactNode
}) {
  if (!apiKey) return <>{children}</>

  return (
    <Provider apiKey={apiKey} region={region}>
      {children}
    </Provider>
  )
}
