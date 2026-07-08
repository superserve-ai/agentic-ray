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
 * server instances (they resolve the team independently): memberships arrive
 * in cell order already, so only within-cell order needs pinning — the sort
 * is stable and compares nothing across regions.
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
  const ordered = memberships.toSorted((a, b) =>
    a.region === b.region ? a.teamId.localeCompare(b.teamId) : 0,
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
