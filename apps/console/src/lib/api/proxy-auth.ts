import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"

import { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

export { getProxySecret, hashKey } from "@/lib/api/proxy-secret"

const PROXY_KEY_NAME = "__console_proxy__"
// Bump this when you want to force-rotate every user's proxy key.
const PROXY_KEY_VERSION = "v1"

/** @internal — exported for tests. Deterministic per-user key derivation. */
export function deriveRawKey(userId: string): string {
  const mac = crypto
    .createHmac("sha256", getProxySecret())
    .update(`${PROXY_KEY_VERSION}:${userId}`)
    .digest()
  return `ss_live_${mac.toString("base64url")}`
}

// Tracks which users have had their api_key row ensured in this process.
// This is not a secret cache — losing it only costs one extra idempotent
// INSERT. Safe across instances because the DB write is idempotent.
const ensuredUsers = new Set<string>()
// team_id is stable per user and not a secret; safe to cache in-process.
const teamIdCache = new Map<string, string>()

async function ensureProfile(userId: string, email: string): Promise<void> {
  const admin = createAdminClient()
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

  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`Failed to create profile: ${error.message}`)
  }
}

async function getTeamForUser(userId: string, email: string): Promise<string> {
  const cached = teamIdCache.get(userId)
  if (cached) return cached

  const admin = createAdminClient()

  await ensureProfile(userId, email)

  const { data: membership } = await admin
    .from("team_member")
    .select("team_id")
    .eq("profile_id", userId)
    .limit(1)
    .single()

  if (membership?.team_id) {
    teamIdCache.set(userId, membership.team_id as string)
    return membership.team_id as string
  }

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

  teamIdCache.set(userId, team.id as string)
  return team.id as string
}

export async function getTeamIdForUser(user: User): Promise<string> {
  return getTeamForUser(user.id, user.email ?? user.id)
}

/**
 * Ensure the derived proxy key's hash exists in the api_key table.
 * Idempotent: does an INSERT ... ON CONFLICT (key_hash) DO NOTHING, so
 * concurrent callers across multiple instances cannot stomp each other.
 */
async function ensureProxyKeyRow(
  userId: string,
  email: string,
  keyHash: string,
): Promise<void> {
  if (ensuredUsers.has(userId)) return

  const teamId = await getTeamForUser(userId, email)
  const admin = createAdminClient()

  const { error } = await admin.from("api_key").upsert(
    {
      team_id: teamId,
      key_hash: keyHash,
      name: PROXY_KEY_NAME,
      scopes: [],
      created_by: userId,
    },
    { onConflict: "key_hash", ignoreDuplicates: true },
  )

  if (error) throw new Error(`Failed to ensure proxy key: ${error.message}`)

  ensuredUsers.add(userId)
}

export async function getAuthApiKeyForUser(
  user: User | null,
): Promise<string | null> {
  if (!user) return null

  const rawKey = deriveRawKey(user.id)
  await ensureProxyKeyRow(user.id, user.email ?? user.id, hashKey(rawKey))
  return rawKey
}

/**
 * Authenticate the current request and return the API key to inject.
 * Returns null if the user is not authenticated.
 */
export async function getAuthApiKey(): Promise<string | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return getAuthApiKeyForUser(user)
}
