import crypto from "node:crypto"

import { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
import { createAdminClient } from "@/lib/supabase/admin"
import type { PlatformImpersonationReadScope } from "./permissions"

export const IMPERSONATION_KEY_NAME = "__console_impersonation__"
const IMPERSONATION_KEY_PURPOSE = "imp:v1"
const DEFAULT_TTL_MINUTES = 30

const keyExpiryCache = new Map<
  string,
  { expiresAtMs: number; scopesKey: string }
>()

export function deriveConsoleKey(
  purpose: string,
  adminId: string,
  teamId: string,
): string {
  const mac = crypto
    .createHmac("sha256", getProxySecret())
    .update(`${purpose}:${adminId}:${teamId}`)
    .digest()
  return `ss_live_${mac.toString("base64url")}`
}

export function deriveImpersonationKey(
  adminId: string,
  teamId: string,
): string {
  return deriveConsoleKey(IMPERSONATION_KEY_PURPOSE, adminId, teamId)
}

export async function ensureImpersonationKeyRow(
  adminId: string,
  teamId: string,
  scopes: PlatformImpersonationReadScope[],
  ttlMinutes: number = DEFAULT_TTL_MINUTES,
): Promise<string> {
  if (scopes.length === 0) {
    throw new Error("Impersonation key requires at least one read scope")
  }

  const rawKey = deriveImpersonationKey(adminId, teamId)
  const keyHash = hashKey(rawKey)
  const ttlMs = ttlMinutes * 60_000
  const now = Date.now()
  const scopesKey = scopes.join(",")

  const cachedExpiry = keyExpiryCache.get(keyHash)
  if (
    cachedExpiry !== undefined &&
    cachedExpiry.scopesKey === scopesKey &&
    cachedExpiry.expiresAtMs - now > ttlMs / 2
  ) {
    return rawKey
  }

  const expiresAtMs = now + ttlMs
  const admin = createAdminClient()
  const { error } = await admin.from("api_key").upsert(
    {
      team_id: teamId,
      key_hash: keyHash,
      name: IMPERSONATION_KEY_NAME,
      scopes,
      created_by: adminId,
      expires_at: new Date(expiresAtMs).toISOString(),
      revoked_at: null,
    },
    { onConflict: "key_hash" },
  )

  if (error) {
    throw new Error(`Failed to ensure impersonation key: ${error.message}`)
  }

  keyExpiryCache.set(keyHash, { expiresAtMs, scopesKey })
  return rawKey
}

export async function revokeImpersonationKeyRow(
  adminId: string,
  teamId: string,
): Promise<void> {
  const rawKey = deriveImpersonationKey(adminId, teamId)
  const keyHash = hashKey(rawKey)
  keyExpiryCache.delete(keyHash)

  const admin = createAdminClient()
  const { error } = await admin
    .from("api_key")
    .update({ revoked_at: new Date().toISOString() })
    .eq("key_hash", keyHash)

  if (error) {
    throw new Error(`Failed to revoke impersonation key: ${error.message}`)
  }
}
