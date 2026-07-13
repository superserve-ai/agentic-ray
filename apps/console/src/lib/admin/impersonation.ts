import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"
import { cookies, headers } from "next/headers"

import { canStartPlatformImpersonation } from "@/lib/admin/permissions"
import { getProxySecret } from "@/lib/api/proxy-secret"
import { findTeamById } from "@/lib/api/team-directory"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
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

/** Token = `${region}.${teamId}.${exp}.${hmac}` (new) or `${teamId}.${exp}.${hmac}` (legacy). */
export function signImpersonationToken(teamId: string, exp: number): string
export function signImpersonationToken(
  region: string,
  teamId: string,
  exp: number,
): string
export function signImpersonationToken(
  arg1: string,
  arg2: number | string,
  arg3?: number,
): string {
  const hasRegion = typeof arg3 === "number"
  const region = hasRegion ? arg1 : DEFAULT_REGION
  const teamId = hasRegion ? (arg2 as string) : arg1
  const exp = hasRegion ? arg3 : (arg2 as number)
  const payload = hasRegion ? `${region}.${teamId}.${exp}` : `${teamId}.${exp}`
  return `${payload}.${sign(payload)}`
}

interface ParsedImpersonationToken {
  teamId: string
  region?: string
}

function parseImpersonationToken(
  token: string | undefined,
  now: number = Date.now(),
): ParsedImpersonationToken | null {
  if (!token) return null

  const parts = token.split(".")
  if (parts.length !== 3 && parts.length !== 4) return null

  const [a, b, c, d] = parts
  const hasRegion = parts.length === 4
  const region = hasRegion ? a : undefined
  const teamId = hasRegion ? b : a
  const expRaw = hasRegion ? c : b
  const providedSig = hasRegion ? d : c
  const payload = hasRegion
    ? `${region}.${teamId}.${expRaw}`
    : `${teamId}.${expRaw}`
  const expectedSig = sign(payload)
  const provided = Buffer.from(providedSig)
  const expected = Buffer.from(expectedSig)
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return null
  }
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < now) return null
  return { teamId, region }
}

export function verifyImpersonationToken(
  token: string | undefined,
  now: number = Date.now(),
): string | null {
  return parseImpersonationToken(token, now)?.teamId ?? null
}

export async function readImpersonationTeamId(): Promise<string | null> {
  const store = await cookies()
  return verifyImpersonationToken(store.get(IMPERSONATION_COOKIE)?.value)
}

export async function hasImpersonationCookie(): Promise<boolean> {
  const store = await cookies()
  return Boolean(store.get(IMPERSONATION_COOKIE)?.value)
}

export interface ImpersonationContext {
  teamId: string
  region: string
}

export async function readImpersonationContext(): Promise<ImpersonationContext | null> {
  const store = await cookies()
  const parsed = parseImpersonationToken(store.get(IMPERSONATION_COOKIE)?.value)
  if (!parsed) return null

  if (parsed.region) {
    return {
      teamId: parsed.teamId,
      region: parsed.region,
    }
  }

  const team = await findTeamById(parsed.teamId)
  if (!team) return null

  return {
    teamId: team.id,
    region: team.region,
  }
}

/**
 * The team the current request should act as: the target team only when the
 * user has platform sandbox read access AND a valid impersonation cookie is
 * present; otherwise null (callers fall back to the user's own team).
 */
export async function getImpersonationTeamId(
  user: User | null | undefined,
): Promise<string | null> {
  if (!canStartPlatformImpersonation(user)) return null
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

export async function setImpersonationCookie(
  teamId: string,
  region: string = DEFAULT_REGION,
): Promise<void> {
  const store = await cookies()
  const token = signImpersonationToken(
    region,
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

export interface ImpersonationDisplayContext {
  teamId: string
  region: string
  teamName: string
}

export async function getImpersonationContext(
  user?: User | null,
): Promise<ImpersonationDisplayContext | null> {
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

  const context = await readImpersonationContext()
  if (!context || context.teamId !== teamId) return null

  const admin = cellFor(context.region).createAdminClient()
  const { data: team } = await admin
    .from("team")
    .select("name")
    .eq("id", context.teamId)
    .single()

  return {
    teamId: context.teamId,
    region: context.region,
    teamName: (team?.name as string | undefined) ?? "another team",
  }
}
