"use server"

import { redirect } from "next/navigation"

import {
  clearImpersonationCookie,
  readImpersonationTeamId,
  setImpersonationCookie,
} from "@/lib/admin/impersonation"
import { revokeImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

import { canReadPlatformSandboxes } from "./permissions"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_TEAMS = 1000

export interface AdminTeamRow {
  id: string
  name: string
  active_sandbox_count: number
  max_sandboxes: number
  created_at: string
}

async function requirePlatformSandboxRead() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !canReadPlatformSandboxes(user)) {
    throw new Error("Forbidden: platform sandbox read access required")
  }
  return user
}

export async function listAllTeamsAction(): Promise<AdminTeamRow[]> {
  await requirePlatformSandboxRead()
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("team")
    .select("id, name, active_sandbox_count, max_sandboxes, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_TEAMS)

  if (error) throw new Error(error.message)
  return (data ?? []) as AdminTeamRow[]
}

export async function getTeamAction(teamId: string) {
  await requirePlatformSandboxRead()
  if (!UUID_RE.test(teamId)) {
    throw new Error("Invalid team id")
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("team")
    .select("id, name, active_sandbox_count, max_sandboxes, created_at")
    .eq("id", teamId)
    .single()

  if (error) throw new Error(error.message)
  return data as AdminTeamRow
}

export async function startImpersonationAction(teamId: string) {
  await requirePlatformSandboxRead()
  if (!UUID_RE.test(teamId)) {
    throw new Error("Invalid team id")
  }

  const admin = createAdminClient()
  const { data: team, error } = await admin
    .from("team")
    .select("id")
    .eq("id", teamId)
    .single()
  if (error || !team) throw new Error("Team not found")

  await setImpersonationCookie(teamId)
  redirect("/sandboxes")
}

export async function stopImpersonationAction() {
  let user

  try {
    user = await requirePlatformSandboxRead()
  } catch {
    redirect("/admin")
  }

  const teamId = await readImpersonationTeamId()
  await clearImpersonationCookie()
  if (user && teamId) {
    try {
      await revokeImpersonationKeyRow(user.id, teamId)
    } catch {
      // Exit should not be blocked by best-effort cleanup failure.
    }
  }

  redirect("/admin")
}
