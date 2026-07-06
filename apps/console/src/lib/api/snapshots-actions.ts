"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

async function getTeamId(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("team_member")
    .select("team_id")
    .eq("profile_id", userId)
    .limit(1)
    .single()
  return data?.team_id ?? null
}

export async function listSnapshotsBySandboxAction(sandboxId: string) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const teamId = await getTeamId(user.id)
  if (!teamId) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("snapshot")
    .select(
      "id, sandbox_id, team_id, name, size_bytes, saved, trigger, created_at",
    )
    .eq("sandbox_id", sandboxId)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map((s) => ({
    id: s.id as string,
    sandbox_id: s.sandbox_id as string,
    name: (s.name as string | null) ?? null,
    size_bytes: s.size_bytes as number,
    saved: s.saved as boolean,
    trigger: s.trigger as string,
    created_at: s.created_at as string,
  }))
}

export async function listSnapshotsAction() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const teamId = await getTeamId(user.id)
  if (!teamId) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("snapshot")
    .select(
      "id, sandbox_id, team_id, name, size_bytes, saved, trigger, created_at",
    )
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map((s) => ({
    id: s.id as string,
    sandbox_id: s.sandbox_id as string,
    name: (s.name as string | null) ?? null,
    size_bytes: s.size_bytes as number,
    saved: s.saved as boolean,
    trigger: s.trigger as string,
    created_at: s.created_at as string,
  }))
}
