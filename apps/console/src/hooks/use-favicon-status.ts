"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { sandboxKeys } from "@/lib/api/query-keys"
import { listSandboxesPaged } from "@/lib/api/sandboxes"
import type { SandboxListParams } from "@/lib/api/types"

const DEFAULT_FAVICON = "/favicon.ico"
const ACTIVE_FAVICON = "/favicon-active.ico"

// We only need to know whether ANY sandbox is currently resuming, so fetch a
// single-row page filtered to that status and read the total off the header.
// This keeps the always-mounted favicon poll cheap instead of pulling the
// whole sandbox list on every dashboard page.
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

  const hasTransitional = (data?.total ?? 0) > 0

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
    if (!link) return

    link.href = hasTransitional ? ACTIVE_FAVICON : DEFAULT_FAVICON
  }, [hasTransitional])
}
