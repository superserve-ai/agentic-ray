import { cookies } from "next/headers"

import {
  listTeamMembershipsForUser,
  type TeamMembership,
} from "@/lib/api/team-directory"

// The user's selected team, stored as "<region>:<teamId>". The cookie is a
// preference, never an authorization: every read validates it against the
// user's live memberships and silently falls back when it no longer matches
// (membership revoked, team moved to another cell, cookie hand-edited).
export const ACTIVE_TEAM_COOKIE = "ss-active-team"

export interface TeamSelection {
  region: string
  teamId: string
}

export function parseTeamSelection(
  value: string | undefined,
): TeamSelection | null {
  if (!value) return null
  const sep = value.indexOf(":")
  if (sep <= 0 || sep === value.length - 1) return null
  return { region: value.slice(0, sep), teamId: value.slice(sep + 1) }
}

export function serializeTeamSelection(selection: TeamSelection): string {
  return `${selection.region}:${selection.teamId}`
}

/** The stored selection for this request, or null when none was ever set. */
export async function readTeamSelection(): Promise<TeamSelection | null> {
  const store = await cookies()
  return parseTeamSelection(store.get(ACTIVE_TEAM_COOKIE)?.value)
}

/**
 * The membership the console operates on. The selection wins when it matches
 * a live membership. The fallback must be deterministic across surfaces and
 * server instances (they resolve the team independently): regions keep their
 * incoming (cell) order via a first-appearance rank, and within a region the
 * team id pins the order. Ranking rather than a conditional comparator keeps
 * the sort a strict weak ordering — returning 0 across regions while
 * comparing ids within one is not transitive, and engines may order such
 * comparators arbitrarily.
 */
export function pickActiveTeam(
  memberships: TeamMembership[],
  selection: TeamSelection | null,
): TeamMembership | null {
  if (selection) {
    const match = memberships.find(
      (m) => m.teamId === selection.teamId && m.region === selection.region,
    )
    if (match) return match
  }
  const regionRank = new Map<string, number>()
  for (const m of memberships) {
    if (!regionRank.has(m.region)) regionRank.set(m.region, regionRank.size)
  }
  const ordered = memberships.toSorted(
    (a, b) =>
      (regionRank.get(a.region) as number) -
        (regionRank.get(b.region) as number) ||
      a.teamId.localeCompare(b.teamId),
  )
  return ordered[0] ?? null
}

export async function resolveActiveTeam(
  userId: string,
): Promise<TeamMembership | null> {
  const [memberships, selection] = await Promise.all([
    listTeamMembershipsForUser(userId),
    readTeamSelection(),
  ])
  return pickActiveTeam(memberships, selection)
}
