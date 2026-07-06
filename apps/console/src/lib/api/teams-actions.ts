"use server"

import { listTeamsForUser } from "@/lib/api/team-directory"
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
}

export async function listTeamsAction(): Promise<TeamDirectoryResponse> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const teams = await listTeamsForUser(user.id)
  return { teams, regions: creatableRegions(user.email) }
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
  const { error: membershipErr } = await admin.from("team_memberships").insert({
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
    throw new Error(`Failed to assign ${TEAM_OWNER_ROLE}: ${assignErr.message}`)
  }

  return {
    id: team.id as string,
    name: team.name as string,
    region: targetRegion,
  }
}
