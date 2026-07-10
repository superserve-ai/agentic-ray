import { cellFor } from "@/lib/cells"

// Role granted to a team's creator. Seeded by the control-plane RBAC
// migration in every cell; looked up by name so the id can differ per cell.
const TEAM_OWNER_ROLE = "team_owner"

export interface ProvisionedTeam {
  id: string
  name: string
  region: string
}

/**
 * Create a team homed in `region` and write everything the control plane
 * needs to authorize `userId` as its owner, all in that cell: the profile
 * row (auth is global but profile rows are per-cell), the team with
 * home_region, the legacy team_member row the console's own lookups read,
 * and the RBAC chain (active membership + team_owner assignment). Without the
 * RBAC chain the console can list the team but the control plane rejects
 * every request for it.
 *
 * This is the ONLY correct way to create a team: both the explicit
 * create-team action and the first-login auto-provision route through it, so
 * a new user can never end up with a legacy-only team the control plane 403s.
 *
 * Postgrest calls aren't a transaction, so a failure mid-chain is unwound in
 * reverse dependency order — a partial team the console lists but the control
 * plane rejects is worse than no team. A per-cell RPC doing the whole chain
 * in one transaction is the durable replacement.
 *
 * ponytail: best-effort compensating unwind, not a real transaction —
 * replace with a per-cell RPC if half-written teams start showing up.
 *
 * The caller owns authorization (who may create where) and cache
 * invalidation; this only writes the rows.
 */
export async function provisionTeam(
  region: string,
  userId: string,
  email: string,
  name: string,
): Promise<ProvisionedTeam> {
  const admin = cellFor(region).createAdminClient()

  // The user may have never touched this cell before; upsert so a concurrent
  // create can't fail on the unique id.
  const { error: profileErr } = await admin
    .from("profile")
    .upsert({ id: userId, email }, { onConflict: "id", ignoreDuplicates: true })
  if (profileErr) {
    throw new Error(`Failed to create profile: ${profileErr.message}`)
  }

  const { data: team, error: teamErr } = await admin
    .from("team")
    .insert({ name, home_region: region })
    .select("id, name")
    .single()
  if (teamErr) throw new Error(`Failed to create team: ${teamErr.message}`)

  try {
    const { error: memberErr } = await admin.from("team_member").insert({
      team_id: team.id,
      profile_id: userId,
      role: "owner",
    })
    if (memberErr) {
      throw new Error(`Failed to add team member: ${memberErr.message}`)
    }

    // Membership must exist (and be active) before the role assignment — the
    // control-plane schema enforces that ordering with a trigger.
    const { error: membershipErr } = await admin
      .from("team_memberships")
      .insert({ team_id: team.id, user_id: userId, status: "active" })
    if (membershipErr) {
      throw new Error(
        `Failed to create team membership: ${membershipErr.message}`,
      )
    }

    const { data: role, error: roleErr } = await admin
      .from("roles")
      .select("id")
      .eq("name", TEAM_OWNER_ROLE)
      .single()
    if (roleErr || !role) {
      throw new Error(
        `Failed to look up ${TEAM_OWNER_ROLE} role: ${roleErr?.message ?? "not found"}`,
      )
    }

    const { error: assignErr } = await admin
      .from("user_role_assignments")
      .insert({
        user_id: userId,
        role_id: role.id,
        scope_type: "team",
        team_id: team.id,
      })
    if (assignErr) {
      throw new Error(
        `Failed to assign ${TEAM_OWNER_ROLE}: ${assignErr.message}`,
      )
    }
  } catch (chainErr) {
    // Best-effort unwind in reverse dependency order, so a mid-chain failure
    // can't leave a team the console lists but the control plane rejects.
    // Failures here are logged and the original error is surfaced with the
    // team id for manual repair.
    for (const [table, column] of [
      ["user_role_assignments", "team_id"],
      ["team_memberships", "team_id"],
      ["team_member", "team_id"],
      ["team", "id"],
    ] as const) {
      const { error: unwindErr } = await admin
        .from(table)
        .delete()
        .eq(column, team.id)
      if (unwindErr) {
        console.error(
          `provision-team unwind: failed to delete from ${table} for team ${team.id}: ${unwindErr.message}`,
        )
      }
    }
    throw new Error(
      `${chainErr instanceof Error ? chainErr.message : String(chainErr)} (team ${team.id})`,
      { cause: chainErr },
    )
  }

  return { id: team.id as string, name: team.name as string, region }
}
