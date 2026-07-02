"use client"

import { XIcon } from "@phosphor-icons/react"
import { Alert, Button } from "@superserve/ui"
import { useState } from "react"

import { QUOTA_WARNING_PCT, useQuotaUsage } from "@/hooks/use-quota-usage"

const CONTACT_HREF =
  "mailto:support@superserve.ai?subject=Increase%20sandbox%20limit"

// Warns once a team reaches QUOTA_WARNING_PCT of its sandbox limit. Reads live
// usage (self-clears on delete); dismiss is per-session so it returns next visit.
export function QuotaWarningBanner() {
  const [dismissed, setDismissed] = useState(false)
  const { data } = useQuotaUsage()

  // Integer compare (not data.pct) to match the watcher exactly, so banner and
  // email never disagree at the boundary.
  const atWarning =
    !!data &&
    data.maxSandboxes > 0 &&
    data.activeSandboxes * 100 >= data.maxSandboxes * QUOTA_WARNING_PCT

  if (dismissed || !atWarning) {
    return null
  }

  return (
    <div className="px-4 pt-4">
      <Alert
        variant="warning"
        title="You're approaching your sandbox limit"
        className="ml-auto max-w-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <p>
            You're using {data.activeSandboxes} of {data.maxSandboxes}{" "}
            sandboxes. Contact us at{" "}
            <a
              href={CONTACT_HREF}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              support@superserve.ai
            </a>{" "}
            to increase your limit.
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
          >
            <XIcon className="size-3.5" weight="light" />
          </Button>
        </div>
      </Alert>
    </div>
  )
}
