import { cellFor, configuredRegions, DEFAULT_REGION } from "@/lib/cells"

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
 * Run a per-cell lookup across every configured cell in parallel, merged in
 * region order (default cell first).
 *
 * Failure isolation follows the cell architecture: an outage in a secondary
 * cell must not take the console down for everyone else, so non-default
 * cells degrade to an empty result (logged). The default cell still throws —
 * that keeps single-cell behavior identical to the pre-cells console, and a
 * hard failure there means the console is broken anyway.
 */
async function acrossCells<T>(
  lookup: (region: string) => Promise<T[]>,
): Promise<T[]> {
  const regions = configuredRegions()
  const settled = await Promise.allSettled(regions.map(lookup))

  const merged: T[] = []
  settled.forEach((result, i) => {
    const region = regions[i]
    if (result.status === "fulfilled") {
      merged.push(...result.value)
      return
    }
    if (region === DEFAULT_REGION) throw result.reason
    console.error(
      `team directory: cell ${region} lookup failed, serving without it:`,
      result.reason,
    )
  })
  return merged
}

/**
 * The user's team memberships across every configured cell, tagged with the
 * cell's region. With a single configured cell this is exactly the one
 * team_member query the console has always made.
 */
export async function listTeamMembershipsForUser(
  userId: string,
): Promise<TeamMembership[]> {
  return acrossCells(async (region) => {
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
  })
}

/**
 * The user's teams across every configured cell, for directory UI. Same
 * fan-out as the membership lookup, plus a name lookup in each cell.
 */
export async function listTeamsForUser(
  userId: string,
): Promise<TeamDirectoryEntry[]> {
  return acrossCells(async (region) => {
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
  })
}
