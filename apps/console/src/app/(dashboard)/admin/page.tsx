import { notFound } from "next/navigation"

import {
  canReadPlatformTeams,
  canStartPlatformImpersonation,
} from "@/lib/admin/permissions"
import {
  listAllTeamsAction,
  startImpersonationAction,
} from "@/lib/admin/teams-actions"
import { createServerClient } from "@/lib/supabase/server"

import { AdminTeamsTable } from "./admin-teams-table"

export default async function AdminPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!canReadPlatformTeams(user)) {
    notFound()
  }

  const teams = await listAllTeamsAction()
  return (
    <AdminTeamsTable
      teams={teams}
      canActAs={canStartPlatformImpersonation(user)}
      onActAs={startImpersonationAction}
    />
  )
}
