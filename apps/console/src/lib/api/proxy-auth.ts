import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"

import { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
import {
  listTeamMembershipsForUser,
  type TeamMembership,
} from "@/lib/api/team-directory"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
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

// Authorization state is cached with a short TTL, never indefinitely: a
// user removed from a team (or moved between cells) must lose proxy access
// within a bounded window, not at the next process recycle. The TTL bounds
// staleness to one minute; every entry costs one membership read per user
// per minute to refresh, which is noise.
const AUTHZ_CACHE_TTL_MS = 60_000

interface Expiring<T> {
  value: T
  expires: number
}

function getFresh<T>(map: Map<string, Expiring<T>>, key: string): T | null {
  const entry = map.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    map.delete(key)
    return null
  }
  return entry.value
}

function setFresh<T>(map: Map<string, Expiring<T>>, key: string, value: T) {
  map.set(key, { value, expires: Date.now() + AUTHZ_CACHE_TTL_MS })
}

// Users whose api_key row was ensured recently — re-ensuring is one
// idempotent upsert, so the TTL also heals a server-side key-row deletion.
const ensuredUsers = new Map<string, Expiring<true>>()
// The user's team + home cell. Stable in practice, but it IS authorization
// state, hence the TTL.
const teamCache = new Map<string, Expiring<TeamMembership>>()

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

  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`Failed to create profile: ${error.message}`)
  }
}

async function getTeamForUser(
  userId: string,
  email: string,
): Promise<TeamMembership> {
  const cached = getFresh(teamCache, userId)
  if (cached) return cached

  await ensureProfile(userId, email)

  const membership = (await listTeamMembershipsForUser(userId))[0]
  if (membership) {
    setFresh(teamCache, userId, membership)
    return membership
  }

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

  const created = { teamId: team.id as string, region: DEFAULT_REGION }
  setFresh(teamCache, userId, created)
  return created
}

export async function getTeamIdForUser(user: User): Promise<string> {
  const { teamId } = await getTeamForUser(user.id, user.email ?? user.id)
  return teamId
}

/**
 * Base URL of the control-plane API serving the user's team. Proxied
 * requests must go to the team's home cell — that's the only control plane
 * whose database holds the proxy key row.
 */
export async function getApiBaseUrlForUser(user: User): Promise<string> {
  const { region } = await getTeamForUser(user.id, user.email ?? user.id)
  return cellFor(region).apiBaseUrl
}

/**
 * Ensure the derived proxy key's hash exists in the api_key table of the
 * team's home cell. Idempotent: does an INSERT ... ON CONFLICT (key_hash)
 * DO NOTHING, so concurrent callers across multiple instances cannot stomp
 * each other.
 */
async function ensureProxyKeyRow(
  userId: string,
  email: string,
  keyHash: string,
): Promise<void> {
  if (getFresh(ensuredUsers, userId)) return

  const team = await getTeamForUser(userId, email)
  const admin = cellFor(team.region).createAdminClient()

  const { error } = await admin.from("api_key").upsert(
    {
      team_id: team.teamId,
      key_hash: keyHash,
      name: PROXY_KEY_NAME,
      scopes: [],
      created_by: userId,
    },
    { onConflict: "key_hash", ignoreDuplicates: true },
  )

  if (error) throw new Error(`Failed to ensure proxy key: ${error.message}`)

  setFresh(ensuredUsers, userId, true)
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
