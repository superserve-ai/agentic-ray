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
  // Regions available for team creation, i.e. every configured cell.
  regions: string[]
  // The team every dashboard surface operates on. Identified by id AND
  // region: during a cross-cell migration the same team id can appear in
  // two cells at once, and only one of them is active.
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
  // Resolve the active team from the same list the UI renders, so the
  // directory can never mark a team it doesn't show.
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

/**
 * Switch the dashboard to another of the user's teams. Membership is
 * verified before the cookie is written; reads re-verify on every request,
 * so the cookie only ever narrows which valid membership is used.
 */
export async function setActiveTeamAction(
  teamId: string,
  region: string,
): Promise<void> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  // The target names its cell, so validate the membership there alone — the
  // every-cell fan-out buys nothing here and doubles the action's latency.
  if (
    !configuredRegions().includes(region) ||
    !(await membershipExistsInCell(region, user.id, teamId))
  ) {
    throw new Error("You are not a member of that team")
  }

  await storeTeamSelection({ region, teamId })
}

/**
 * Create a team homed in the given cell. The full RBAC chain the control
 * plane needs is written by `provisionTeam`; this action only enforces who
 * may create where, then lands the creator in the new team.
 */
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

  // The user just gained a membership; drop their cached directory so the
  // very next read sees the new team instead of waiting out the TTL.
  invalidateMembershipDirectory(user.id)

  // Land the creator in the team they just made — the reason to create a
  // team is almost always to start working in it.
  await storeTeamSelection({ region: targetRegion, teamId: team.id })

  return { id: team.id, name: team.name, region: targetRegion }
}
