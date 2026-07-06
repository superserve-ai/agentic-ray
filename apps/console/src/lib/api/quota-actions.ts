"use server"

import {
  listTeamMembershipsForUser,
  type TeamMembership,
} from "@/lib/api/team-directory"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

export interface QuotaUsageResponse {
  activeSandboxes: number
  maxSandboxes: number
  pct: number
}

async function getTeam(userId: string): Promise<TeamMembership | null> {
  const memberships = await listTeamMembershipsForUser(userId)
  if (!memberships.length) return null

  const uniqueTeams = new Map(memberships.map((m) => [m.teamId, m]))
  // Ambient poller with no team-selector: an ambiguous (multi-team) membership
  // renders nothing rather than throwing on every poll (which would spam logs).
  if (uniqueTeams.size !== 1) {
    return null
  }
  return [...uniqueTeams.values()][0]
}

// Current team's sandbox usage for the in-product quota banner; null when the
// user has no team yet.
export async function getQuotaUsageAction(): Promise<QuotaUsageResponse | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!user) throw new Error("Not authenticated")

  const team = await getTeam(user.id)
  if (!team) return null

  const admin = cellFor(team.region).createAdminClient()
  const { data, error } = await admin
    .from("team")
    .select("active_sandbox_count, max_sandboxes")
    .eq("id", team.teamId)
    .single()
  if (error) throw new Error(error.message)

  const activeSandboxes = data.active_sandbox_count ?? 0
  const maxSandboxes = data.max_sandboxes ?? 0
  // Floor via integer division, matching the watcher's `used*100 >= limit*pct`,
  // so the banner never shows "80%" or fires below the email threshold.
  const pct =
    maxSandboxes > 0 ? Math.floor((activeSandboxes * 100) / maxSandboxes) : 0

  return { activeSandboxes, maxSandboxes, pct }
}
