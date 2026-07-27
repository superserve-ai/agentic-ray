"use client"

import { type UseQueryResult, useQuery } from "@tanstack/react-query"

import { useBillingContext } from "@/hooks/use-billing-context"
import {
  getBillingSummary,
  type BillingSummaryResponse,
} from "@/lib/api/billing"
import { billingKeys } from "@/lib/api/query-keys"

export function useBillingSummary(
  enabled = true,
): UseQueryResult<BillingSummaryResponse, Error> {
  const { cacheScope, teamKey, ready } = useBillingContext()

  return useQuery<BillingSummaryResponse, Error>({
    queryKey:
      teamKey !== null
        ? billingKeys.summary({ cacheScope, teamKey })
        : billingKeys.summary({ cacheScope, teamKey: "unresolved" }),
    queryFn: getBillingSummary,
    enabled: enabled && ready,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}
