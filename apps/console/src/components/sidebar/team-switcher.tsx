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
 * (sandboxes, keys, snapshots, billing) operates on. Hidden for single-team
 * users (nothing to switch between) and off the multi-cell UI allowlist
 * (switching rolls out person-by-person; the server enforces this too).
 */
export function TeamSwitcher() {
  const { data } = useTeams()
  const switchTeam = useSwitchTeam()
  const { addToast } = useToast()

  if (!data || !data.switchingEnabled || data.teams.length < 2) return null

  const active = data.teams.find(
    (t) => t.id === data.activeTeamId && t.region === data.activeRegion,
  )
  // Region badges only add signal when the directory spans regions.
  const multiRegion = new Set(data.teams.map((t) => t.region)).size > 1

  const teamLabel = (team: { name: string; region: string }) =>
    multiRegion ? `${team.name} · ${regionLabel(team.region)}` : team.name

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
          {/* Base UI's Value renders the raw option value (`region:id`) by
              default — the label has to be rendered explicitly. */}
          <SelectValue className="truncate">
            {() => (active ? teamLabel(active) : "Select team")}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup dropdown>
          {data.teams.map((team) => (
            <SelectItem key={optionValue(team)} value={optionValue(team)}>
              {teamLabel(team)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  )
}
