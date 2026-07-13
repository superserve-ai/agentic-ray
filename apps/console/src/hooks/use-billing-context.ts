"use client"

import { useQueryScope } from "@/components/query-provider"

import { useTeams } from "./use-teams"

export interface BillingQueryContext {
  cacheScope: string
  teamKey: string | null
  ready: boolean
}

export function useBillingContext(): BillingQueryContext {
  const cacheScope = useQueryScope()
  const { data: teams } = useTeams()
  const teamKey =
    teams?.activeTeamId && teams.activeRegion
      ? `${teams.activeRegion}:${teams.activeTeamId}`
      : null

  return {
    cacheScope,
    teamKey,
    ready: teamKey !== null,
  }
}
