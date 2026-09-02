"use server"

import { cookies } from "next/headers"

import {
  ACTIVE_TEAM_COOKIE,
  pickActiveTeam,
  readTeamSelection,
  serializeTeamSelection,
  type TeamSelection,
} from "@/lib/api/active-team"
import {
  invalidateMembershipDirectory,
  listTeamsForUser,
  membershipExistsInCell,
} from "@/lib/api/team-directory"
import { provisionTeam } from "@/lib/api/team-provisioning"
import { configuredRegions, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

export interface TeamSummary {
  id: string
  name: string
  region: string
}

export interface TeamDirectoryResponse {
  teams: TeamSummary[]
  regions: string[]
  activeTeamId: string | null
  activeRegion: string | null
}

export async function listTeamsAction(): Promise<TeamDirectoryResponse> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const [teams, selection] = await Promise.all([
    listTeamsForUser(user.id),
    readTeamSelection(),
  ])
  const active = pickActiveTeam(
    teams.map((t) => ({ teamId: t.id, region: t.region })),
    selection,
  )
  return {
    teams,
    regions: configuredRegions(),
    activeTeamId: active?.teamId ?? null,
    activeRegion: active?.region ?? null,
  }
}

async function storeTeamSelection(selection: TeamSelection): Promise<void> {
  const store = await cookies()
  store.set(ACTIVE_TEAM_COOKIE, serializeTeamSelection(selection), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
}

export async function setActiveTeamAction(
  teamId: string,
  region: string,
): Promise<void> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  if (
    !configuredRegions().includes(region) ||
    !(await membershipExistsInCell(region, user.id, teamId))
  ) {
    throw new Error("You are not a member of that team")
  }

  await storeTeamSelection({ region, teamId })
}

export async function createTeamAction(
  name: string,
  region?: string,
): Promise<TeamSummary> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const trimmed = name.trim()
  if (!trimmed) throw new Error("Team name is required")

  const targetRegion = region ?? DEFAULT_REGION
  if (!configuredRegions().includes(targetRegion)) {
    throw new Error(`Region ${targetRegion} is not available`)
  }

  const team = await provisionTeam(
    targetRegion,
    user.id,
    user.email ?? user.id,
    trimmed,
  )

  invalidateMembershipDirectory(user.id)
  await storeTeamSelection({ region: targetRegion, teamId: team.id })

  return { id: team.id, name: team.name, region: targetRegion }
}
