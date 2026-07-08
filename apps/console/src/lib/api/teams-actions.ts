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
  listTeamMembershipsForUser,
  listTeamsForUser,
} from "@/lib/api/team-directory"
import { cellFor, creatableRegions, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

// Role granted to a team's creator. Seeded by the control-plane RBAC
// migration in every cell; looked up by name so the id can differ per cell.
const TEAM_OWNER_ROLE = "team_owner"

export interface TeamSummary {
  id: string
  name: string
  region: string
}

export interface TeamDirectoryResponse {
  teams: TeamSummary[]
  // Regions THIS USER may create teams in. Length 1 unless a second cell is
  // configured AND the user is on the multi-cell UI allowlist — which is
  // what gates the region select in the UI.
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
    regions: creatableRegions(user.email),
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

  const memberships = await listTeamMembershipsForUser(user.id)
  const match = memberships.find(
    (m) => m.teamId === teamId && m.region === region,
  )
  if (!match) throw new Error("You are not a member of that team")

  await storeTeamSelection({ region, teamId })
}

/**
 * Create a team homed in the given cell. Everything the control plane needs
 * to authorize the creator is written in that cell: profile (auth is global
 * but profile rows are per-cell), team with home_region, the legacy
 * team_member row the console's own lookups read, and the RBAC chain
 * (active membership + team_owner assignment) — without which the control
 * plane rejects every request for the team.
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

  // Server-side enforcement, not just UI hiding: non-default regions
  // require the multi-cell allowlist (internal-first rollout).
  const targetRegion = region ?? DEFAULT_REGION
  if (!creatableRegions(user.email).includes(targetRegion)) {
    throw new Error(`Region ${targetRegion} is not available`)
  }

  const admin = cellFor(targetRegion).createAdminClient()

  // The user may have never touched this cell before; upsert so a concurrent
  // create can't fail on the unique id.
  const { error: profileErr } = await admin
    .from("profile")
    .upsert(
      { id: user.id, email: user.email ?? user.id },
      { onConflict: "id", ignoreDuplicates: true },
    )
  if (profileErr) {
    throw new Error(`Failed to create profile: ${profileErr.message}`)
  }

  const { data: team, error: teamErr } = await admin
    .from("team")
    .insert({ name: trimmed, home_region: targetRegion })
    .select("id, name")
    .single()
  if (teamErr) throw new Error(`Failed to create team: ${teamErr.message}`)

  // Postgrest calls aren't a transaction, so a failure mid-chain would leave
  // a team the console can list but the control plane rejects (no RBAC
  // chain). Compensate by unwinding what was written; a per-cell RPC that
  // does the whole chain in one transaction is the durable replacement.
  try {
    const { error: memberErr } = await admin.from("team_member").insert({
      team_id: team.id,
      profile_id: user.id,
      role: "owner",
    })
    if (memberErr) {
      throw new Error(`Failed to add team member: ${memberErr.message}`)
    }

    // Membership must exist (and be active) before the role assignment — the
    // control-plane schema enforces that ordering with a trigger.
    const { error: membershipErr } = await admin
      .from("team_memberships")
      .insert({
        team_id: team.id,
        user_id: user.id,
        status: "active",
      })
    if (membershipErr) {
      throw new Error(
        `Failed to create team membership: ${membershipErr.message}`,
      )
    }

    const { data: role, error: roleErr } = await admin
      .from("roles")
      .select("id")
      .eq("name", TEAM_OWNER_ROLE)
      .single()
    if (roleErr || !role) {
      throw new Error(
        `Failed to look up ${TEAM_OWNER_ROLE} role: ${roleErr?.message ?? "not found"}`,
      )
    }

    const { error: assignErr } = await admin
      .from("user_role_assignments")
      .insert({
        user_id: user.id,
        role_id: role.id,
        scope_type: "team",
        team_id: team.id,
      })
    if (assignErr) {
      throw new Error(
        `Failed to assign ${TEAM_OWNER_ROLE}: ${assignErr.message}`,
      )
    }
  } catch (chainErr) {
    // Best-effort unwind in reverse dependency order, so a mid-chain failure
    // can't leave a team the console lists but the control plane rejects.
    // Failures here are logged and the original error is surfaced with the
    // team id for manual repair.
    for (const [table, column] of [
      ["user_role_assignments", "team_id"],
      ["team_memberships", "team_id"],
      ["team_member", "team_id"],
      ["team", "id"],
    ] as const) {
      const { error: unwindErr } = await admin
        .from(table)
        .delete()
        .eq(column, team.id)
      if (unwindErr) {
        console.error(
          `create-team unwind: failed to delete from ${table} for team ${team.id}: ${unwindErr.message}`,
        )
      }
    }
    throw new Error(
      `${chainErr instanceof Error ? chainErr.message : String(chainErr)} (team ${team.id})`,
      { cause: chainErr },
    )
  }

  // Land the creator in the team they just made — the reason to create a
  // team is almost always to start working in it.
  await storeTeamSelection({ region: targetRegion, teamId: team.id as string })

  return {
    id: team.id as string,
    name: team.name as string,
    region: targetRegion,
  }
}
