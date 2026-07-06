import { cellFor, configuredRegions } from "@/lib/cells"

export interface TeamMembership {
  teamId: string
  region: string
}

export interface TeamDirectoryEntry {
  id: string
  name: string
  region: string
}

/**
 * The user's team memberships across every configured cell, tagged with the
 * cell's region. Cells are queried in parallel and merged in region order
 * (default cell first), so with a single configured cell this is exactly the
 * one team_member query the console has always made.
 */
export async function listTeamMembershipsForUser(
  userId: string,
): Promise<TeamMembership[]> {
  const perCell = await Promise.all(
    configuredRegions().map(async (region) => {
      const admin = cellFor(region).createAdminClient()
      const { data, error } = await admin
        .from("team_member")
        .select("team_id")
        .eq("profile_id", userId)

      if (error) throw new Error(error.message)

      return (data ?? [])
        .map((row) => row.team_id)
        .filter((teamId): teamId is string => typeof teamId === "string")
        .map((teamId) => ({ teamId, region }))
    }),
  )
  return perCell.flat()
}

/**
 * The user's teams across every configured cell, for directory UI. Same
 * fan-out as the membership lookup, plus a name lookup in each cell.
 */
export async function listTeamsForUser(
  userId: string,
): Promise<TeamDirectoryEntry[]> {
  const perCell = await Promise.all(
    configuredRegions().map(async (region) => {
      const admin = cellFor(region).createAdminClient()
      const { data: memberships, error } = await admin
        .from("team_member")
        .select("team_id")
        .eq("profile_id", userId)

      if (error) throw new Error(error.message)

      const teamIds = [
        ...new Set(
          (memberships ?? [])
            .map((row) => row.team_id)
            .filter((teamId): teamId is string => typeof teamId === "string"),
        ),
      ]
      if (!teamIds.length) return []

      const { data: teams, error: teamErr } = await admin
        .from("team")
        .select("id, name")
        .in("id", teamIds)

      if (teamErr) throw new Error(teamErr.message)

      return (teams ?? []).map((t) => ({
        id: t.id as string,
        name: t.name as string,
        region,
      }))
    }),
  )
  return perCell.flat()
}
