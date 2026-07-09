"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { teamKeys } from "@/lib/api/query-keys"
import {
  createTeamAction,
  listTeamsAction,
  setActiveTeamAction,
  type TeamDirectoryResponse,
} from "@/lib/api/teams-actions"

export function useTeams() {
  return useQuery({
    queryKey: teamKeys.directory(),
    queryFn: listTeamsAction,
    staleTime: 5 * 60_000,
  })
}

/**
 * Drop every cached dataset that belongs to the previous team. Reset (not
 * invalidate) so stale rows can never flash while the new team's data loads;
 * active queries refetch immediately, inactive ones on next mount. The team
 * directory is exempt — it is team-agnostic and already carries the new
 * selection.
 */
function resetTeamScopedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.resetQueries({
    predicate: (query) => query.queryKey[0] !== teamKeys.all[0],
  })
}

export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, region }: { name: string; region: string }) =>
      createTeamAction(name, region),
    onSuccess: () => {
      // Creating a team also switches to it, and the directory itself gained
      // a row — refetch it rather than patching it.
      void queryClient.invalidateQueries({ queryKey: teamKeys.directory() })
      resetTeamScopedQueries(queryClient)
    },
  })
}

export function useSwitchTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ teamId, region }: { teamId: string; region: string }) =>
      setActiveTeamAction(teamId, region),
    // Flip the switcher immediately; the server action only validates and
    // stores the cookie. Rolled back on error.
    onMutate: async ({ teamId, region }) => {
      await queryClient.cancelQueries({ queryKey: teamKeys.directory() })
      const previous = queryClient.getQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
      )
      queryClient.setQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
        (old) =>
          old ? { ...old, activeTeamId: teamId, activeRegion: region } : old,
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(teamKeys.directory(), context.previous)
      }
    },
    onSuccess: () => {
      // No router.refresh(): the dashboard shell is a pure client layout, so
      // a refresh would only re-render RSC payloads that carry no team data —
      // and it invalidates the router cache, re-fetching every prefetched
      // route alongside the query refetches.
      resetTeamScopedQueries(queryClient)
    },
  })
}
