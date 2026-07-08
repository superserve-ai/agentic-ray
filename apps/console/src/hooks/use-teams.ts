"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import { teamKeys } from "@/lib/api/query-keys"
import {
  createTeamAction,
  listTeamsAction,
  setActiveTeamAction,
} from "@/lib/api/teams-actions"

export function useTeams() {
  return useQuery({
    queryKey: teamKeys.directory(),
    queryFn: listTeamsAction,
    staleTime: 5 * 60_000,
  })
}

export function useCreateTeam() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: ({ name, region }: { name: string; region: string }) =>
      createTeamAction(name, region),
    onSuccess: () => {
      // Creating a team also switches to it, so the whole cache is stale,
      // not just the directory.
      queryClient.clear()
      router.refresh()
    },
  })
}

export function useSwitchTeam() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: ({ teamId, region }: { teamId: string; region: string }) =>
      setActiveTeamAction(teamId, region),
    onSuccess: () => {
      // Every cached list (sandboxes, keys, snapshots, …) belongs to the
      // previous team; drop everything rather than enumerating keys.
      queryClient.clear()
      router.refresh()
    },
  })
}
