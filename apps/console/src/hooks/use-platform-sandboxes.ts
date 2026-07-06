"use client"

import { useQuery } from "@tanstack/react-query"

import {
  getPlatformTeamSandbox,
  listPlatformTeamSandboxes,
} from "@/lib/api/platform-sandboxes"
import { platformSandboxKeys } from "@/lib/api/query-keys"

export function usePlatformTeamSandboxes(teamId: string | null) {
  return useQuery({
    queryKey: platformSandboxKeys.byTeam(teamId ?? ""),
    queryFn: () => listPlatformTeamSandboxes(teamId as string),
    enabled: !!teamId,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
}

export function usePlatformTeamSandbox(
  teamId: string | null,
  sandboxId: string | null,
) {
  return useQuery({
    queryKey: platformSandboxKeys.detail(teamId ?? "", sandboxId ?? ""),
    queryFn: () =>
      getPlatformTeamSandbox(teamId as string, sandboxId as string),
    enabled: !!teamId && !!sandboxId,
    refetchOnWindowFocus: true,
  })
}
