"use client"

import {
  Button,
  Field,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Separator,
  useToast,
} from "@superserve/ui"
import { useState } from "react"

import { useCreateTeam, useTeams } from "@/hooks/use-teams"

const REGION_LABELS: Record<string, string> = {
  use: "US East",
  usw: "US West",
}

function regionLabel(region: string): string {
  return REGION_LABELS[region] ?? region
}

/**
 * Team directory + create-team form. Only rendered when more than one cell
 * is configured — the single-cell console has no team creation surface, and
 * that must stay true until a second region exists to choose from.
 */
export function TeamsSection() {
  const { data } = useTeams()
  const createTeam = useCreateTeam()
  const { addToast } = useToast()

  const [name, setName] = useState("")
  const [region, setRegion] = useState("use")

  if (!data || data.regions.length <= 1) return null

  const handleCreate = () => {
    createTeam.mutate(
      { name, region },
      {
        onSuccess: (team) => {
          setName("")
          addToast(
            `Team ${team.name} created in ${regionLabel(team.region)}`,
            "success",
          )
        },
        onError: (error) => {
          addToast(error.message || "Failed to create team", "error")
        },
      },
    )
  }

  return (
    <>
      <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
        <div>
          <h2 className="text-base font-medium text-foreground">Teams</h2>
          <p className="mt-1 text-xs text-muted">
            Your teams and the region each is homed in.
          </p>
        </div>
        <div className="max-w-md space-y-5">
          <div className="border border-dashed border-border">
            {data.teams.map((team) => (
              <div
                key={`${team.region}:${team.id}`}
                className="flex items-center justify-between border-b border-dashed border-border px-4 py-3 last:border-b-0"
              >
                <span className="text-sm text-foreground">{team.name}</span>
                <span className="font-mono text-xs text-muted uppercase">
                  {regionLabel(team.region)}
                </span>
              </div>
            ))}
            {data.teams.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted">No teams yet.</p>
            )}
          </div>
          <Field label="New Team Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-team"
            />
          </Field>
          <Field label="Region">
            <Select
              value={region}
              onValueChange={(v) => setRegion(v as string)}
            >
              <SelectTrigger aria-label="Team region">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {data.regions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {regionLabel(r)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>
          <div>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || createTeam.isPending}
              size="sm"
            >
              {createTeam.isPending ? "Creating..." : "Create Team"}
            </Button>
          </div>
        </div>
      </div>

      <Separator />
    </>
  )
}
