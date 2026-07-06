"use client"

import { useQuery } from "@tanstack/react-query"

import { quotaKeys } from "@/lib/api/query-keys"
import { getQuotaUsageAction } from "@/lib/api/quota-actions"

/** Usage at or above this percent of the sandbox limit surfaces the banner. */
export const QUOTA_WARNING_PCT = 80

export function useQuotaUsage() {
  return useQuery({
    queryKey: quotaKeys.usage(),
    queryFn: getQuotaUsageAction,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  })
}
