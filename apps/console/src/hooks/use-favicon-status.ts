"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { sandboxKeys } from "@/lib/api/query-keys"
import { listSandboxesPaged } from "@/lib/api/sandboxes"
import type { SandboxListParams } from "@/lib/api/types"

const DEFAULT_FAVICON = "/favicon.ico"
const ACTIVE_FAVICON = "/favicon-active.ico"

// We only need to know whether ANY sandbox is currently resuming, so fetch a
// single-row page filtered to that status. This keeps the always-mounted
// favicon poll cheap instead of pulling the whole sandbox list on every
// dashboard page.
const RESUMING_PROBE: SandboxListParams = {
  page: 1,
  pageSize: 1,
  sort: "created_at",
  order: "desc",
  status: "resuming",
}

export function useFaviconStatus() {
  const { data } = useQuery({
    queryKey: sandboxKeys.list(RESUMING_PROBE),
    queryFn: () => listSandboxesPaged(RESUMING_PROBE),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })

  // Check the rows' actual status rather than trusting total > 0: against an
  // API build that ignores the status/limit params (the fallback case
  // apiClientList handles), the probe gets the full unfiltered list back and a
  // count-based check would keep the active favicon on forever.
  const hasTransitional =
    data?.items.some((s) => s.status === "resuming") ?? false

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
    if (!link) return

    link.href = hasTransitional ? ACTIVE_FAVICON : DEFAULT_FAVICON
  }, [hasTransitional])
}
