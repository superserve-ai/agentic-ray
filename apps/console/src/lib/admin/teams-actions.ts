"use server"

import { redirect } from "next/navigation"

import {
  clearImpersonationCookie,
  readImpersonationContext,
  setImpersonationCookie,
} from "@/lib/admin/impersonation"
import { revokeImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import { findTeamById, listAllTeams } from "@/lib/api/team-directory"
import { createServerClient } from "@/lib/supabase/server"

import {
  canReadPlatformTeams,
  canStartPlatformImpersonation,
} from "./permissions"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AdminTeamRow {
  id: string
  name: string
  active_sandbox_count: number
  max_sandboxes: number
  created_at: string
}

async function requirePlatformTeamRead() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !canReadPlatformTeams(user)) {
    throw new Error("Forbidden: platform team read access required")
  }
  return user
}

async function requirePlatformImpersonationAccess() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !canStartPlatformImpersonation(user)) {
    throw new Error("Forbidden: platform impersonation access required")
  }
  return user
}

export async function listAllTeamsAction(): Promise<AdminTeamRow[]> {
  await requirePlatformTeamRead()
  return (await listAllTeams()).map(({ region: _region, ...team }) => team)
}

export async function getTeamAction(teamId: string) {
  await requirePlatformTeamRead()
  if (!UUID_RE.test(teamId)) {
    throw new Error("Invalid team id")
  }

  const team = await findTeamById(teamId)
  if (!team) throw new Error("Team not found")
  const { region: _region, ...row } = team
  return row
}

export async function startImpersonationAction(teamId: string) {
  await requirePlatformImpersonationAccess()
  if (!UUID_RE.test(teamId)) {
    throw new Error("Invalid team id")
  }

  const team = await findTeamById(teamId)
  if (!team) throw new Error("Team not found")

  await setImpersonationCookie(teamId, team.region)
  redirect("/sandboxes")
}

export async function stopImpersonationAction() {
  const impersonation = await readImpersonationContext()
  await clearImpersonationCookie()

  let user
  try {
    user = await requirePlatformImpersonationAccess()
  } catch {
    redirect("/admin")
  }

  if (user && impersonation) {
    try {
      await revokeImpersonationKeyRow(
        user.id,
        impersonation.teamId,
        impersonation.region,
      )
    } catch {
      // Exit should not be blocked by best-effort cleanup failure.
    }
  }

  redirect("/admin")
}
