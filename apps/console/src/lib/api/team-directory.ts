import type { SupabaseClient } from "@supabase/supabase-js"

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
): Promise<{ items: T[]; degradedRegions: string[] }> {
  const regions = configuredRegions()
  const settled = await Promise.allSettled(regions.map(lookup))

  const items: T[] = []
  const degradedRegions: string[] = []
  settled.forEach((result, i) => {
    const region = regions[i]
    if (result.status === "fulfilled") {
      items.push(...result.value)
      return
    }
    if (region === DEFAULT_REGION) throw result.reason
    degradedRegions.push(region)
    console.error(
      `team directory: cell ${region} lookup failed, serving without it:`,
      result.reason,
    )
  })
  return { items, degradedRegions }
}

export interface MembershipDirectory {
  memberships: TeamMembership[]
  // Secondary cells whose lookup failed and whose memberships are therefore
  // missing from the list. Callers that infer anything from the SHAPE of the
  // membership set (e.g. "exactly one team") must treat a degraded read as
  // ambiguous rather than authoritative.
  degradedRegions: string[]
}

/**
 * Membership lookup that also reports which cells could not be read. Use
 * this wherever "how many teams does this user have" changes behavior.
 */
export async function listTeamMembershipsForUserDetailed(
  userId: string,
): Promise<MembershipDirectory> {
  const { items, degradedRegions } = await acrossCells(async (region) => {
    const admin = cellFor(region).createAdminClient()
    return membershipTeamIdsInCell(admin, userId).then((teamIds) =>
      teamIds.map((teamId) => ({ teamId, region })),
    )
  })
  return { memberships: items, degradedRegions }
}

/**
 * Team ids the user is authorized for in one cell. RBAC `team_memberships`
 * is authoritative whenever a row exists — only `status = 'active'` passes,
 * so a user deactivated through the backend user-management endpoints loses
 * console access too (the console's service-role reads bypass backend RBAC,
 * so this lookup is the console's authorization boundary). Legacy
 * `team_member` rows count only for members with no RBAC row at all: those
 * are pre-RBAC memberships that were never migrated (10 exist in prod as of
 * 2026-07), and treating the legacy table as a discovery hint — never as an
 * override — keeps them working without letting it resurrect revoked access.
 */
async function membershipTeamIdsInCell(
  admin: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const [rbac, legacy] = await Promise.all([
    admin
      .from("team_memberships")
      .select("team_id, status")
      .eq("user_id", userId),
    admin.from("team_member").select("team_id").eq("profile_id", userId),
  ])
  if (rbac.error) throw new Error(rbac.error.message)
  if (legacy.error) throw new Error(legacy.error.message)

  const rbacRows = (rbac.data ?? []).filter(
    (row): row is { team_id: string; status: string } =>
      typeof row.team_id === "string",
  )
  const rbacByTeam = new Map(rbacRows.map((row) => [row.team_id, row.status]))

  const allowed = new Set<string>(
    rbacRows.filter((row) => row.status === "active").map((row) => row.team_id),
  )
  for (const row of legacy.data ?? []) {
    if (typeof row.team_id !== "string") continue
    if (!rbacByTeam.has(row.team_id)) allowed.add(row.team_id)
  }
  return [...allowed]
}

/**
 * The user's team memberships across every configured cell, tagged with the
 * cell's region. With a single configured cell this is exactly the one
 * team_member query the console has always made.
 */
export async function listTeamMembershipsForUser(
  userId: string,
): Promise<TeamMembership[]> {
  const { memberships } = await listTeamMembershipsForUserDetailed(userId)
  return memberships
}

/**
 * The user's teams across every configured cell, for directory UI. Same
 * fan-out as the membership lookup, plus a name lookup in each cell.
 */
export async function listTeamsForUser(
  userId: string,
): Promise<TeamDirectoryEntry[]> {
  const { items } = await acrossCells(async (region) => {
    const admin = cellFor(region).createAdminClient()
    // Same authorization boundary as the membership lookup — a deactivated
    // member must not see the team in the directory either.
    const teamIds = await membershipTeamIdsInCell(admin, userId)
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
  return items
}
