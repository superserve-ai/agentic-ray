"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

export interface QuotaUsageResponse {
  activeSandboxes: number
  maxSandboxes: number
  pct: number
}

async function getTeamId(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("team_member")
    .select("team_id")
    .eq("profile_id", userId)

  if (error) throw new Error(error.message)
  if (!data?.length) return null

  const teamIds = [
    ...new Set(
      data
        .map((row) => row.team_id)
        .filter((teamId): teamId is string => typeof teamId === "string"),
    ),
  ]
  // Ambient poller with no team-selector: an ambiguous (multi-team) membership
  // renders nothing rather than throwing on every poll (which would spam logs).
  if (teamIds.length !== 1) {
    return null
  }
  return teamIds[0]
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

  const teamId = await getTeamId(user.id)
  if (!teamId) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("team")
    .select("active_sandbox_count, max_sandboxes")
    .eq("id", teamId)
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
