"use client"

import { useQuery } from "@tanstack/react-query"

import { useBillingContext } from "@/hooks/use-billing-context"
import {
  getCustomerBillingUsage,
  getCustomerBillingExportPreview,
  listCustomerBillingPeriods,
  type CustomerBillingExportPreviewResponse,
  type CustomerBillingPeriodsResponse,
  type CustomerBillingUsageResponse,
} from "@/lib/api/billing-stripe"
import { billingKeys } from "@/lib/api/query-keys"

export function useCustomerBillingPeriods(
  teamId: string | null | undefined,
  teamKey: string | null | undefined,
  limit = 8,
  enabled = true,
) {
  const { cacheScope, ready } = useBillingContext()

  return useQuery<CustomerBillingPeriodsResponse, Error>({
    queryKey: billingKeys.customer.periods({
      cacheScope,
      teamKey: teamKey ?? teamId ?? "unresolved",
      limit,
    }),
    queryFn: () => {
      if (!teamId) {
        throw new Error("Missing team id")
      }
      return listCustomerBillingPeriods(teamId, limit)
    },
    enabled: enabled && ready && !!teamId,
    staleTime: 60_000,
  })
}

export function useCustomerBillingUsage(
  teamId: string | null | undefined,
  teamKey: string | null | undefined,
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
  enabled = true,
) {
  const { cacheScope, ready } = useBillingContext()

  return useQuery<CustomerBillingUsageResponse, Error>({
    queryKey: billingKeys.customer.usage({
      cacheScope,
      teamKey: teamKey ?? teamId ?? "unresolved",
      periodStart: periodStart ?? "unresolved",
      periodEnd: periodEnd ?? "unresolved",
    }),
    queryFn: () => {
      if (!teamId || !periodStart || !periodEnd) {
        throw new Error("Missing billing usage parameters")
      }
      return getCustomerBillingUsage(teamId, periodStart, periodEnd)
    },
    enabled: enabled && ready && !!teamId && !!periodStart && !!periodEnd,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}

export function useCustomerBillingExportPreview(
  teamId: string | null | undefined,
  teamKey: string | null | undefined,
  periodId: string | null | undefined,
  enabled = true,
) {
  const { cacheScope, ready } = useBillingContext()

  return useQuery<CustomerBillingExportPreviewResponse, Error>({
    queryKey: billingKeys.customer.exportPreview({
      cacheScope,
      teamKey: teamKey ?? teamId ?? "unresolved",
      periodId: periodId ?? "unresolved",
    }),
    queryFn: () => {
      if (!teamId || !periodId) {
        throw new Error("Missing export preview parameters")
      }
      return getCustomerBillingExportPreview(teamId, periodId)
    },
    enabled: enabled && ready && !!teamId && !!periodId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}
