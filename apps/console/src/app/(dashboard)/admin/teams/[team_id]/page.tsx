import { notFound } from "next/navigation"

import { canReadPlatformSandboxes } from "@/lib/admin/permissions"
import { getTeamAction } from "@/lib/admin/teams-actions"
import { createServerClient } from "@/lib/supabase/server"

import { TeamSandboxesClient } from "./team-sandboxes-client"

export default async function TeamSandboxesPage({
  params,
}: {
  params: Promise<{ team_id: string }>
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!canReadPlatformSandboxes(user)) {
    notFound()
  }

  const { team_id: teamId } = await params
  let team
  try {
    team = await getTeamAction(teamId)
  } catch {
    notFound()
  }

  return <TeamSandboxesClient teamId={team.id} teamName={team.name} />
}
