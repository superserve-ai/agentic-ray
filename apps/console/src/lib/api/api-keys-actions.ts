"use server"

import crypto from "node:crypto"

import {
  listTeamMembershipsForUser,
  type TeamMembership,
} from "@/lib/api/team-directory"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

// Region codes embedded in new API keys (ss_live_<region>_...). Must stay in
// sync with the team_home_region_valid CHECK constraint in the control-plane
// schema. The region segment lets the API edge route a request to the team's
// home cell from the key string alone — no directory lookup. Legacy keys
// without a region segment keep working: the control plane hashes the whole
// string, so the format is opaque to auth.
const REGION_CODES = new Set(["use", "usw"])

function generateRawKey(region: string): string {
  const bytes = crypto.randomBytes(24)
  return `ss_live_${region}_${bytes.toString("base64url")}`
}

/**
 * A team's home region determines which cell serves its API traffic; new keys
 * carry it as a routing hint. Falls back to the default region if the
 * home_region migration hasn't been applied yet or the value is unknown, so
 * key creation never breaks on schema skew.
 */
async function getTeamHomeRegion(team: TeamMembership): Promise<string> {
  const admin = cellFor(team.region).createAdminClient()
  const { data, error } = await admin
    .from("team")
    .select("home_region")
    .eq("id", team.teamId)
    .single()
  if (error || !data?.home_region || !REGION_CODES.has(data.home_region)) {
    return DEFAULT_REGION
  }
  return data.home_region as string
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex")
}

/**
 * Ensure a profile row exists for the authenticated user in the default
 * cell. The Go backend schema requires profile(id) to match auth.users(id).
 */
async function ensureProfile(userId: string, email: string): Promise<void> {
  const admin = cellFor(DEFAULT_REGION).createAdminClient()
  const { data: existing } = await admin
    .from("profile")
    .select("id")
    .eq("id", userId)
    .single()

  if (existing) return

  const { error } = await admin.from("profile").insert({
    id: userId,
    email,
  })

  // Ignore unique-violation (23505) — profile was created concurrently
  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`Failed to create profile: ${error.message}`)
  }
}

/**
 * Look up the user's team across configured cells. If no team exists,
 * auto-create one (named after their email) in the default cell and add
 * them as owner.
 */
async function getOrCreateTeamForUser(
  userId: string,
  email: string,
): Promise<TeamMembership> {
  // Ensure profile exists first (FK target for team_member and api_key)
  await ensureProfile(userId, email)

  // Try to find existing team membership in any configured cell
  const memberships = await listTeamMembershipsForUser(userId)
  if (memberships[0]) return memberships[0]

  // No team — create one in the default cell and add user as owner
  const admin = cellFor(DEFAULT_REGION).createAdminClient()
  const { data: team, error: teamErr } = await admin
    .from("team")
    .insert({ name: email })
    .select("id")
    .single()

  if (teamErr) throw new Error(`Failed to create team: ${teamErr.message}`)

  const { error: memberErr } = await admin.from("team_member").insert({
    team_id: team.id,
    profile_id: userId,
    role: "owner",
  })

  if (memberErr)
    throw new Error(`Failed to add team member: ${memberErr.message}`)

  return { teamId: team.id as string, region: DEFAULT_REGION }
}

export async function listApiKeysAction() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const team = await getOrCreateTeamForUser(user.id, user.email ?? user.id)

  const admin = cellFor(team.region).createAdminClient()
  const { data, error } = await admin
    .from("api_key")
    .select("id, name, key_hash, created_at, last_used_at")
    .eq("team_id", team.teamId)
    .is("revoked_at", null)
    .neq("name", "__console_proxy__")
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map((k) => ({
    id: k.id as string,
    name: k.name as string,
    prefix: `${(k.key_hash as string).slice(0, 8)}...`,
    created_at: k.created_at as string,
    last_used_at: k.last_used_at as string | null,
  }))
}

export async function createApiKeyAction(name: string) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const team = await getOrCreateTeamForUser(user.id, user.email ?? user.id)

  const region = await getTeamHomeRegion(team)
  const rawKey = generateRawKey(region)
  const keyHash = hashKey(rawKey)
  // ss_live_<region>_ plus the first 8 random chars, e.g. "ss_live_use_AbCdEfGh..."
  // Sliced relative to the region length so a future region code of a
  // different length still shows exactly 8 random chars.
  const keyPrefix = `${rawKey.slice(0, `ss_live_${region}_`.length + 8)}...`

  // The key row must live in the team's cell — that's the database the
  // team's control plane authenticates against.
  const admin = cellFor(team.region).createAdminClient()
  const { data, error } = await admin
    .from("api_key")
    .insert({
      team_id: team.teamId,
      key_hash: keyHash,
      name,
      scopes: [],
      created_by: user.id,
    })
    .select("id, name, created_at")
    .single()

  if (error) throw new Error(error.message)

  return {
    id: data.id as string,
    name: data.name as string,
    key: rawKey,
    prefix: keyPrefix,
    created_at: data.created_at as string,
  }
}

export async function revokeApiKeyAction(id: string) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const team = await getOrCreateTeamForUser(user.id, user.email ?? user.id)

  const admin = cellFor(team.region).createAdminClient()
  const { error } = await admin
    .from("api_key")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("team_id", team.teamId)

  if (error) throw new Error(error.message)
}
