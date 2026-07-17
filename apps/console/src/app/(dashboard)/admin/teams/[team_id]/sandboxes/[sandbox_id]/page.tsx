import { notFound } from "next/navigation"

import { canReadPlatformSandboxes } from "@/lib/admin/permissions"
import { getTeamAction } from "@/lib/admin/teams-actions"
import { createServerClient } from "@/lib/supabase/server"

import { AdminSandboxDetailClient } from "./sandbox-detail-client"

export default async function AdminSandboxDetailPage({
  params,
}: {
  params: Promise<{ team_id: string; sandbox_id: string }>
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!canReadPlatformSandboxes(user)) {
    notFound()
  }

  const { team_id: teamId, sandbox_id: sandboxId } = await params
  let team
  try {
    team = await getTeamAction(teamId)
  } catch {
    notFound()
  }

  return (
    <AdminSandboxDetailClient
      teamId={team.id}
      teamName={team.name}
      sandboxId={sandboxId}
    />
  )
}
