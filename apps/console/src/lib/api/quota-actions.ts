"use server"

import { pickActiveTeam, readTeamSelection } from "@/lib/api/active-team"
import {
  listTeamMembershipsForUserDetailed,
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
  const { memberships, degradedRegions } =
    await listTeamMembershipsForUserDetailed(userId)

  // A partial directory read makes the membership shape untrustworthy — the
  // banner renders nothing rather than showing a possibly-wrong team's quota.
  if (degradedRegions.length > 0) return null

  return pickActiveTeam(memberships, await readTeamSelection())
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
  // Live counts come from the sharded-counter view (team.active_sandbox_count
  // is frozen); a team with no counter rows is absent from the view — zero.
  // Admin client required: the view is security_invoker over an RLS-deny
  // table, and a user-scoped client reads empty rows, not an error.
  const [teamRes, countRes] = await Promise.all([
    admin.from("team").select("max_sandboxes").eq("id", team.teamId).single(),
    admin
      .from("team_active_sandbox_counts")
      .select("active_sandbox_count")
      .eq("team_id", team.teamId)
      .maybeSingle(),
  ])
  if (teamRes.error) throw new Error(teamRes.error.message)
  if (countRes.error) throw new Error(countRes.error.message)

  const activeSandboxes = countRes.data?.active_sandbox_count ?? 0
  const maxSandboxes = teamRes.data.max_sandboxes ?? 0
  // Floor via integer division, matching the watcher's `used*100 >= limit*pct`,
  // so the banner never shows "80%" or fires below the email threshold.
  const pct =
    maxSandboxes > 0 ? Math.floor((activeSandboxes * 100) / maxSandboxes) : 0

  return { activeSandboxes, maxSandboxes, pct }
}
