"use client"

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@superserve/ui"

import { useSwitchTeam, useTeams } from "@/hooks/use-teams"
import { regionLabel } from "@/lib/format"

// Option values pair region with id: during a cross-cell migration the same
// team id can exist in two cells, and they are different choices.
function optionValue(team: { id: string; region: string }): string {
  return `${team.region}:${team.id}`
}

/**
 * Sidebar control for the active team — the team every dashboard surface
 * (sandboxes, keys, snapshots, billing) operates on. Hidden for
 * single-team users, who have nothing to switch between.
 */
export function TeamSwitcher() {
  const { data } = useTeams()
  const switchTeam = useSwitchTeam()
  const { addToast } = useToast()

  if (!data || data.teams.length < 2) return null

  const active = data.teams.find(
    (t) => t.id === data.activeTeamId && t.region === data.activeRegion,
  )

  const handleSwitch = (value: string) => {
    const team = data.teams.find((t) => optionValue(t) === value)
    if (!team || team === active) return
    switchTeam.mutate(
      { teamId: team.id, region: team.region },
      {
        onError: (error) => {
          addToast(error.message || "Failed to switch team", "error")
        },
      },
    )
  }

  return (
    <div className="mb-2 px-2.5">
      <Select
        value={active ? optionValue(active) : undefined}
        onValueChange={(v) => handleSwitch(v as string)}
        disabled={switchTeam.isPending}
      >
        <SelectTrigger aria-label="Active team" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {data.teams.map((team) => (
            <SelectItem key={optionValue(team)} value={optionValue(team)}>
              {team.name} · {regionLabel(team.region)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  )
}
