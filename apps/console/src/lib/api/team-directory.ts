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

export interface TeamRecord extends TeamDirectoryEntry {
  active_sandbox_count: number
  max_sandboxes: number
  created_at: string
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
  opts?: { maxAgeMs?: number },
): Promise<MembershipDirectory> {
  const maxAgeMs = opts?.maxAgeMs ?? DIRECTORY_CACHE_TTL_MS
  // Strict inequality so maxAgeMs 0 can never hit cache, even for a read in
  // the same millisecond as the fill.
  const cached = directoryCache.get(userId)
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) {
    return cached.promise
  }

  const fetchedAt = Date.now()
  const promise = acrossCells(async (region) => {
    const admin = cellFor(region).createAdminClient()
    return membershipTeamIdsInCell(admin, userId).then((teamIds) =>
      teamIds.map((teamId) => ({ teamId, region })),
    )
  }).then(({ items, degradedRegions }) => ({
    memberships: items,
    degradedRegions,
  }))

  // The in-flight promise is cached too, so the burst of parallel server
  // actions after a page load or team switch collapses into one fan-out.
  // Failures are evicted rather than cached.
  directoryCache.set(userId, { promise, fetchedAt })
  promise.catch(() => {
    if (directoryCache.get(userId)?.promise === promise) {
      directoryCache.delete(userId)
    }
  })
  return promise
}

// Membership reads back most server actions, so a fan-out per action call
// adds two queries per cell before any real work. Same staleness model as
// proxy-auth's authz cache: this IS authorization state, so it's cached for
// one bounded minute, never indefinitely. Callers whose correctness depends
// on a fresh read (billing fails closed on degraded cells) pass maxAgeMs: 0.
const DIRECTORY_CACHE_TTL_MS = 60_000
const directoryCache = new Map<
  string,
  { promise: Promise<MembershipDirectory>; fetchedAt: number }
>()

/** Evict a user's cached membership directory (e.g. after creating a team). */
export function invalidateMembershipDirectory(userId: string): void {
  directoryCache.delete(userId)
}

/** @internal — for tests, which reuse user ids across cases. */
export function clearMembershipDirectoryCache(): void {
  directoryCache.clear()
}

/**
 * Whether the user is authorized for one specific team in one specific cell
 * — the membership lookup scoped to a single region, for callers that
 * already know the target (e.g. validating a team switch) and shouldn't pay
 * the every-cell fan-out. Always a fresh read: it guards writes.
 */
export async function membershipExistsInCell(
  region: string,
  userId: string,
  teamId: string,
): Promise<boolean> {
  const admin = cellFor(region).createAdminClient()
  const teamIds = await membershipTeamIdsInCell(admin, userId)
  return teamIds.includes(teamId)
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

/**
 * All teams across every configured cell, tagged with their source region.
 * Admin pages use this to avoid the default-cell-only blind spot.
 */
export async function listAllTeams(): Promise<TeamRecord[]> {
  const { items } = await acrossCells(async (region) => {
    const admin = cellFor(region).createAdminClient()
    const { data: teams, error } = await admin
      .from("team")
      .select("id, name, active_sandbox_count, max_sandboxes, created_at")

    if (error) throw new Error(error.message)

    return (teams ?? []).map((team) => ({
      id: team.id as string,
      name: team.name as string,
      active_sandbox_count: team.active_sandbox_count as number,
      max_sandboxes: team.max_sandboxes as number,
      created_at: team.created_at as string,
      region,
    }))
  })

  return items
    .toSorted((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 1000)
}

async function findTeamInRegion(
  region: string,
  teamId: string,
): Promise<TeamRecord | null> {
  const admin = cellFor(region).createAdminClient()
  const { data: teams, error } = await admin
    .from("team")
    .select("id, name, active_sandbox_count, max_sandboxes, created_at")
    .eq("id", teamId)
    .limit(1)

  if (error) throw new Error(error.message)

  const team = teams?.[0]
  if (!team) return null

  return {
    id: team.id as string,
    name: team.name as string,
    active_sandbox_count: team.active_sandbox_count as number,
    max_sandboxes: team.max_sandboxes as number,
    created_at: team.created_at as string,
    region,
  }
}

/**
 * Find a team by id across all configured cells. Returns the first match
 * with its source region, or null if the team does not exist anywhere.
 */
export async function findTeamById(teamId: string): Promise<TeamRecord | null> {
  const regions = configuredRegions()
  for (const region of regions) {
    const team = await findTeamInRegion(region, teamId)
    if (team) return team
  }

  return null
}
