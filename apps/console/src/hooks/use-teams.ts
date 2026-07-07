"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { teamKeys } from "@/lib/api/query-keys"
import { createTeamAction, listTeamsAction } from "@/lib/api/teams-actions"

export function useTeams() {
  return useQuery({
    queryKey: teamKeys.directory(),
    queryFn: listTeamsAction,
    staleTime: 5 * 60_000,
  })
}

export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, region }: { name: string; region: string }) =>
      createTeamAction(name, region),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all })
    },
  })
}
