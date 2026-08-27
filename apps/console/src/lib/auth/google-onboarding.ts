import { pickActiveTeam } from "@/lib/api/active-team"
import {
  type MembershipDirectory,
  type TeamMembership,
} from "@/lib/api/team-directory"

export type GoogleMembershipState =
  | {
      kind: "existing"
      membership: TeamMembership
    }
  | {
      kind: "first_time"
    }
  | {
      kind: "indeterminate"
      degradedRegions: string[]
    }

/**
 * Classify the Google user's onboarding state from the authoritative
 * cross-cell membership read.
 *
 * - existing: at least one live membership was found.
 * - first_time: a complete read confirmed zero memberships everywhere.
 * - indeterminate: the directory read was degraded-empty and no verified
 *   onboarding marker could recover a live membership.
 */
export async function classifyGoogleMembershipState(
  _userId: string,
  directory: MembershipDirectory,
): Promise<GoogleMembershipState> {
  const membership = pickActiveTeam(directory.memberships, null)
  if (membership) {
    return { kind: "existing", membership }
  }

  if (directory.degradedRegions.length > 0) {
    return {
      kind: "indeterminate",
      degradedRegions: directory.degradedRegions,
    }
  }

  return { kind: "first_time" }
}
