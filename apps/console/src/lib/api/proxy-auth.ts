import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"

import {
  type ImpersonationDisplayContext,
  getImpersonationTeamId,
  impersonationTtlMs,
} from "@/lib/admin/impersonation"
import { ensureImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import { platformImpersonationReadScopes } from "@/lib/admin/permissions"
import {
  pickActiveTeam,
  readTeamSelection,
  serializeTeamSelection,
} from "@/lib/api/active-team"
import { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
import {
  invalidateMembershipDirectory,
  listTeamMembershipsForUser,
  findTeamById,
  type TeamMembership,
} from "@/lib/api/team-directory"
import { provisionTeam } from "@/lib/api/team-provisioning"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

export { getProxySecret, hashKey } from "@/lib/api/proxy-secret"

const PROXY_KEY_NAME = "__console_proxy__"
// Bump this when you want to force-rotate every proxy key. v2 added the team
// id to the derivation (one key per user per team, so switching teams swaps
// keys instead of re-pointing one row); v1 rows are inert leftovers.
const PROXY_KEY_VERSION = "v2"

/**
 * @internal — exported for tests. Deterministic per-user-per-team key
 * derivation. The team id is part of the MAC input so each of a user's teams
 * gets its own key row in its own cell, and the injected key always
 * authorizes exactly the active team.
 */
export function deriveRawKey(userId: string, teamId: string): string {
  const mac = crypto
    .createHmac("sha256", getProxySecret())
    .update(`${PROXY_KEY_VERSION}:${userId}:${teamId}`)
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

// user:team pairs whose api_key row was ensured recently — re-ensuring is
// one idempotent upsert, so the TTL also heals a server-side key-row
// deletion.
const ensuredKeys = new Map<string, Expiring<true>>()
// The user's active team + home cell, keyed by user AND selection so a team
// switch takes effect immediately instead of after the TTL.
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
  const selection = await readTeamSelection()
  const cacheKey = `${userId}|${selection ? serializeTeamSelection(selection) : ""}`
  const cached = getFresh(teamCache, cacheKey)
  if (cached) return cached

  await ensureProfile(userId, email)

  const membership = pickActiveTeam(
    await listTeamMembershipsForUser(userId),
    selection,
  )
  if (membership) {
    setFresh(teamCache, cacheKey, membership)
    return membership
  }

  // First login: no membership yet. Provision a team through the same full
  // RBAC chain the create-team action uses — a legacy-only team (team +
  // team_member, no team_memberships/role assignment) is one the console
  // lists but the control plane 403s, so the user's first request fails.
  const team = await provisionTeam(DEFAULT_REGION, userId, email, email)

  // The empty membership list we just read may be cached; drop it so other
  // surfaces (billing, quota, directory) see the new team immediately.
  invalidateMembershipDirectory(userId)

  const created = { teamId: team.id, region: DEFAULT_REGION }
  setFresh(teamCache, cacheKey, created)
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
  team: TeamMembership,
  keyHash: string,
): Promise<void> {
  const ensureKey = `${userId}|${team.region}:${team.teamId}`
  if (getFresh(ensuredKeys, ensureKey)) return

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

  setFresh(ensuredKeys, ensureKey, true)
}

export async function getAuthApiKeyForUser(
  user: User | null,
  impersonatedTarget?:
    | string
    | Pick<ImpersonationDisplayContext, "teamId" | "region">
    | null,
): Promise<string | null> {
  if (!user) return null

  let teamId: string | null
  let region: string | null = null

  if (impersonatedTarget === undefined) {
    teamId = await getImpersonationTeamId(user)
  } else if (typeof impersonatedTarget === "string") {
    teamId = impersonatedTarget
  } else if (impersonatedTarget) {
    teamId = impersonatedTarget.teamId
    region = impersonatedTarget.region
  } else {
    teamId = null
  }

  if (teamId) {
    const scopes = platformImpersonationReadScopes(user)
    if (scopes.length === 0) {
      throw new Error(
        "Forbidden: impersonation requires a supported platform read permission",
      )
    }

    const targetRegion =
      region ?? (await findTeamById(teamId))?.region ?? DEFAULT_REGION

    return ensureImpersonationKeyRow(
      user.id,
      teamId,
      targetRegion,
      scopes,
      Math.floor(impersonationTtlMs() / 60_000),
    )
  }

  const team = await getTeamForUser(user.id, user.email ?? user.id)
  const rawKey = deriveRawKey(user.id, team.teamId)
  await ensureProxyKeyRow(user.id, team, hashKey(rawKey))
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
