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

export async function listActivityBySandboxAction(
  sandboxId: string,
  limit = 50,
) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const teamId = await getTeamId(user.id)
  if (!teamId) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("activity")
    .select(
      "id, sandbox_id, category, action, status, sandbox_name, secret_id, secret_name, duration_ms, error, metadata, created_at",
    )
    .eq("sandbox_id", sandboxId)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  return (data ?? []).map((a) => ({
    id: a.id as string,
    sandbox_id: (a.sandbox_id as string | null) ?? null,
    category: a.category as string,
    action: a.action as string,
    status: (a.status as string | null) ?? null,
    sandbox_name: (a.sandbox_name as string | null) ?? null,
    secret_id: (a.secret_id as string | null) ?? null,
    secret_name: (a.secret_name as string | null) ?? null,
    duration_ms: (a.duration_ms as number | null) ?? null,
    error: (a.error as string | null) ?? null,
    metadata: a.metadata as Record<string, unknown>,
    created_at: a.created_at as string,
  }))
}

export async function listActivityAction(limit = 100) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const teamId = await getTeamId(user.id)
  if (!teamId) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("activity")
    .select(
      "id, sandbox_id, category, action, status, sandbox_name, secret_id, secret_name, duration_ms, error, metadata, created_at",
    )
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  return (data ?? []).map((a) => ({
    id: a.id as string,
    sandbox_id: (a.sandbox_id as string | null) ?? null,
    category: a.category as string,
    action: a.action as string,
    status: (a.status as string | null) ?? null,
    sandbox_name: (a.sandbox_name as string | null) ?? null,
    secret_id: (a.secret_id as string | null) ?? null,
    secret_name: (a.secret_name as string | null) ?? null,
    duration_ms: (a.duration_ms as number | null) ?? null,
    error: (a.error as string | null) ?? null,
    metadata: a.metadata as Record<string, unknown>,
    created_at: a.created_at as string,
  }))
}
