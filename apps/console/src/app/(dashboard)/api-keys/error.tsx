"use client"

import { ErrorState } from "@/components/error-state"

export default function ApiKeysError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <ErrorState onRetry={reset} />
    </div>
  )
}
