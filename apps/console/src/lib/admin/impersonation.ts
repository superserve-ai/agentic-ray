import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"
import { cookies, headers } from "next/headers"

import { canReadPlatformSandboxes } from "@/lib/admin/permissions"
import { getProxySecret } from "@/lib/api/proxy-secret"
import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

export const IMPERSONATION_COOKIE = "ss_impersonate"

const DEFAULT_TTL_MINUTES = 30
const MAX_TTL_MINUTES = 8 * 60

export function impersonationTtlMs(): number {
  const raw = Number(
    process.env.IMPERSONATION_TTL_MINUTES ?? DEFAULT_TTL_MINUTES,
  )
  const mins =
    Number.isFinite(raw) && raw > 0
      ? Math.min(raw, MAX_TTL_MINUTES)
      : DEFAULT_TTL_MINUTES
  return mins * 60_000
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", getProxySecret())
    .update(payload)
    .digest("base64url")
}

/** Token = `${teamId}.${exp}.${hmac}` — tamper-proof and self-expiring. */
export function signImpersonationToken(teamId: string, exp: number): string {
  const payload = `${teamId}.${exp}`
  return `${payload}.${sign(payload)}`
}

export function verifyImpersonationToken(
  token: string | undefined,
  now: number = Date.now(),
): string | null {
  if (!token) return null

  const parts = token.split(".")
  if (parts.length !== 3) return null

  const [teamId, expRaw, providedSig] = parts
  const expectedSig = sign(`${teamId}.${expRaw}`)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < now) return null
  return teamId
}

export async function readImpersonationTeamId(): Promise<string | null> {
  const store = await cookies()
  return verifyImpersonationToken(store.get(IMPERSONATION_COOKIE)?.value)
}

export async function hasImpersonationCookie(): Promise<boolean> {
  const store = await cookies()
  return Boolean(store.get(IMPERSONATION_COOKIE)?.value)
}

/**
 * The team the current request should act as: the target team only when the
 * user has platform sandbox read access AND a valid impersonation cookie is
 * present; otherwise null (callers fall back to the user's own team).
 */
export async function getImpersonationTeamId(
  user: User | null | undefined,
): Promise<string | null> {
  if (!canReadPlatformSandboxes(user)) return null
  return readImpersonationTeamId()
}

async function cookieDomainForRequest(): Promise<string | undefined> {
  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim()
  if (!cookieDomain) return undefined

  const host = (await headers()).get("host")?.split(":")[0]?.toLowerCase()
  if (!host) return undefined

  const normalizedDomain = cookieDomain.replace(/^\./, "").toLowerCase()
  if (host === normalizedDomain || host.endsWith(`.${normalizedDomain}`)) {
    return cookieDomain
  }

  return undefined
}

export async function setImpersonationCookie(teamId: string): Promise<void> {
  const store = await cookies()
  const token = signImpersonationToken(
    teamId,
    Date.now() + impersonationTtlMs(),
  )
  const cookieDomain = await cookieDomainForRequest()

  store.set(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(impersonationTtlMs() / 1000),
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  })
}

export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies()
  const cookieDomain = await cookieDomainForRequest()
  store.set(IMPERSONATION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  })
}

export interface ImpersonationContext {
  teamId: string
  teamName: string
}

export async function getImpersonationContext(
  user?: User | null,
): Promise<ImpersonationContext | null> {
  let resolvedUser = user
  if (resolvedUser === undefined) {
    const supabase = await createServerClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    resolvedUser = authUser
  }

  const teamId = await getImpersonationTeamId(resolvedUser)
  if (!teamId) return null

  const admin = createAdminClient()
  const { data: team } = await admin
    .from("team")
    .select("name")
    .eq("id", teamId)
    .single()

  return {
    teamId,
    teamName: (team?.name as string | undefined) ?? "another team",
  }
}
