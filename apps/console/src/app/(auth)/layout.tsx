import type { Metadata } from "next"

import { FingerprintSignupObserver } from "@/components/fingerprint-signup-observer"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <FingerprintSignupObserver />
      {children}
    </>
  )
}
