"use client"

import { useQuery } from "@tanstack/react-query"

import { useBillingContext } from "@/hooks/use-billing-context"
import {
  getBillingSettingsAction,
  getBillingUsageAction,
} from "@/lib/api/billing-actions"
import { billingKeys } from "@/lib/api/query-keys"

const RECENT_USAGE_WINDOW_MS = 2 * 60 * 60 * 1000

export function useBillingSettings() {
  const { cacheScope, teamKey, ready } = useBillingContext()

  return useQuery({
    queryKey:
      teamKey !== null
        ? billingKeys.settings({ cacheScope, teamKey })
        : billingKeys.settings({ cacheScope, teamKey: "unresolved" }),
    queryFn: getBillingSettingsAction,
    enabled: ready,
    staleTime: 5 * 60_000,
  })
}

export function useBillingUsage(
  periodStart: Date,
  periodEnd: Date,
  enabled = true,
) {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const start = periodStart.toISOString()
  const end = periodEnd.toISOString()

  const overlapsRecentUsage =
    periodEnd.getTime() > Date.now() - RECENT_USAGE_WINDOW_MS

  return useQuery({
    queryKey:
      teamKey !== null
        ? billingKeys.usage({
            cacheScope,
            teamKey,
            periodStart: start,
            periodEnd: end,
          })
        : billingKeys.usage({
            cacheScope,
            teamKey: "unresolved",
            periodStart: start,
            periodEnd: end,
          }),
    queryFn: () => getBillingUsageAction(start, end),
    enabled: enabled && ready,
    staleTime: overlapsRecentUsage ? 30_000 : 30 * 60_000,
    refetchInterval: overlapsRecentUsage ? 60_000 : false,
    refetchIntervalInBackground: false,
  })
}
