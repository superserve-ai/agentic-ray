import { cn, ToastProvider } from "@superserve/ui"
import type { Metadata } from "next"
import { Geist_Mono, Instrument_Sans } from "next/font/google"
import { Suspense } from "react"

import { FingerprintProvider } from "@/components/fingerprint-provider"
import { PostHogPageView } from "@/components/posthog-pageview"
import { PostHogProvider } from "@/components/posthog-provider"

import "./globals.css"

const sansFont = Instrument_Sans({
  subsets: ["latin"],
  variable: "--sans-font",
  display: "swap",
})

const monoFont = Geist_Mono({
  subsets: ["latin"],
  variable: "--mono-font",
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "Superserve Console",
    template: "%s | Superserve",
  },
  description:
    "Deploy and manage cloud sandboxes with Superserve. Run code in isolated, secure environments.",
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
  },
  metadataBase: new URL("https://console.superserve.ai"),
  openGraph: {
    type: "website",
    title: "Superserve Console",
    description:
      "Deploy and manage cloud sandboxes with Superserve. Run code in isolated, secure environments.",
    siteName: "Superserve",
    images: [
      { url: "https://www.superserve.ai/cover.png", width: 1200, height: 630 },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Superserve Console",
    description:
      "Deploy and manage cloud sandboxes with Superserve. Run code in isolated, secure environments.",
    images: ["https://www.superserve.ai/cover.png"],
  },
  other: {
    "theme-color": "#0a0a0a",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PostHogProvider>
      <html lang="en" className={cn(sansFont.variable, monoFont.variable)}>
        <body className="font-sans antialiased" suppressHydrationWarning>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <FingerprintProvider>
            <ToastProvider>{children}</ToastProvider>
          </FingerprintProvider>
        </body>
      </html>
    </PostHogProvider>
  )
}
