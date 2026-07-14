"use server"

import { resolveActiveTeam } from "@/lib/api/active-team"
import type { TeamMembership } from "@/lib/api/team-directory"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

async function getTeam(userId: string): Promise<TeamMembership | null> {
  return resolveActiveTeam(userId).catch(() => null)
}

export async function listActivityBySandboxAction(
  sandboxId: string,
  limit = 50,
) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const team = await getTeam(user.id)
  if (!team) return []

  const admin = cellFor(team.region).createAdminClient()
  const { data, error } = await admin
    .from("activity")
    .select(
      "id, sandbox_id, template_id, category, action, status, sandbox_name, secret_id, secret_name, actor_id, duration_ms, error, metadata, created_at",
    )
    .eq("sandbox_id", sandboxId)
    .eq("team_id", team.teamId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  return (data ?? []).map((a) => ({
    id: a.id as string,
    sandbox_id: (a.sandbox_id as string | null) ?? null,
    template_id: (a.template_id as string | null) ?? null,
    category: a.category as string,
    action: a.action as string,
    status: (a.status as string | null) ?? null,
    sandbox_name: (a.sandbox_name as string | null) ?? null,
    secret_id: (a.secret_id as string | null) ?? null,
    secret_name: (a.secret_name as string | null) ?? null,
    actor_id: (a.actor_id as string | null) ?? null,
    duration_ms: (a.duration_ms as number | null) ?? null,
    error: (a.error as string | null) ?? null,
    metadata: a.metadata as Record<string, unknown>,
    created_at: a.created_at as string,
  }))
}
