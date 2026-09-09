import crypto from "node:crypto"

import { cookies } from "next/headers"

import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"

const COOKIE_NAME = "__Host-superserve-google-signup"
const PURPOSE = "signup_google"
const VERSION = 1
const TTL_SECONDS = 5 * 60
const PENDING_ATTEMPT_COOKIE = "__Host-superserve-google-signup-attempt"

interface ProofPayload {
  v: number
  purpose: string
  exp: number
  signup_attempt_id?: string
}

function cookieName(signupAttemptId?: string): string {
  return signupAttemptId ? `${COOKIE_NAME}-${signupAttemptId}` : COOKIE_NAME
}

function signingSecret(): string {
  const secret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("Google signup proof signing secret is not configured")
  }
  return secret
}

function signature(payload: string): Buffer {
  return crypto.createHmac("sha256", signingSecret()).update(payload).digest()
}

function encodeProof(signupAttemptId?: string): string {
  const payload: ProofPayload = {
    v: VERSION,
    purpose: PURPOSE,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    ...(signupAttemptId ? { signup_attempt_id: signupAttemptId } : {}),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${encoded}.${signature(encoded).toString("base64url")}`
}

function validProof(
  value: string | undefined,
  expectedSignupAttemptId?: string,
  requireUnscoped = false,
): boolean {
  if (!value) return false
  const [encoded, supplied, extra] = value.split(".")
  if (!encoded || !supplied || extra) return false

  let suppliedSignature: Buffer
  try {
    suppliedSignature = Buffer.from(supplied, "base64url")
  } catch {
    return false
  }

  // Node's base64url decoder accepts non-canonical trailing bits, so a
  // one-character mutation can otherwise decode to the same signature.
  if (suppliedSignature.toString("base64url") !== supplied) return false

  const expected = signature(encoded)
  if (
    suppliedSignature.length !== expected.length ||
    !crypto.timingSafeEqual(suppliedSignature, expected)
  ) {
    return false
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<ProofPayload>
    return (
      payload.v === VERSION &&
      payload.purpose === PURPOSE &&
      typeof payload.exp === "number" &&
      payload.exp >= Math.floor(Date.now() / 1000) &&
      (expectedSignupAttemptId === undefined ||
        (typeof expectedSignupAttemptId === "string" &&
          expectedSignupAttemptId.length > 0 &&
          payload.signup_attempt_id === expectedSignupAttemptId)) &&
      (!requireUnscoped || payload.signup_attempt_id === undefined)
    )
  } catch {
    return false
  }
}

export async function issueGoogleSignupProof(
  signupAttemptId?: string,
): Promise<void> {
  const store = await cookies()
  store.set(cookieName(signupAttemptId), encodeProof(signupAttemptId), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  })
}

export async function hasValidGoogleSignupProof(
  expectedSignupAttemptId?: string,
): Promise<boolean> {
  try {
    const store = await cookies()
    if (expectedSignupAttemptId !== undefined) {
      return (
        validProof(
          store.get(cookieName(expectedSignupAttemptId))?.value,
          expectedSignupAttemptId,
        ) || validProof(store.get(COOKIE_NAME)?.value, expectedSignupAttemptId)
      )
    }

    const allCookies = "getAll" in store ? store.getAll() : []
    return (
      validProof(store.get(COOKIE_NAME)?.value) ||
      allCookies.some(({ name, value }) => {
        if (!name.startsWith(`${COOKIE_NAME}-`)) return false
        const signupAttemptId = name.slice(`${COOKIE_NAME}-`.length)
        return validProof(value, signupAttemptId)
      })
    )
  } catch (error) {
    console.error("Google signup proof validation failed", error)
    return false
  }
}

/** Compatibility-only check for proofs issued before attempt-scoped cookies. */
export async function hasValidLegacyGoogleSignupProof(): Promise<boolean> {
  try {
    const store = await cookies()
    return validProof(store.get(COOKIE_NAME)?.value, undefined, true)
  } catch {
    return false
  }
}

export async function markGoogleSignupAttempt(
  signupAttemptId: string,
): Promise<void> {
  const store = await cookies()
  store.set(PENDING_ATTEMPT_COOKIE, signupAttemptId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  })
}

export async function readGoogleSignupAttempt(): Promise<string | undefined> {
  try {
    return (await cookies()).get(PENDING_ATTEMPT_COOKIE)?.value
  } catch {
    return undefined
  }
}

export async function requireGoogleSignupProof(
  expectedSignupAttemptId?: string,
): Promise<string | undefined> {
  try {
    const store = await cookies()
    expectedSignupAttemptId ||= store.get(PENDING_ATTEMPT_COOKIE)?.value
    let matchedAttemptId: string | undefined
    if (expectedSignupAttemptId) {
      if (await hasValidGoogleSignupProof(expectedSignupAttemptId))
        return expectedSignupAttemptId
      // Do not let an abandoned callback pin future provisioning to a stale attempt.
      store.delete(PENDING_ATTEMPT_COOKIE)
      throw new Error("Google signup verification required")
    }

    // Resolve the exact proof that authorized this provisioning request so the
    // caller can consume that same cookie. Provider attempts are independent;
    // never discard the correlation key after validation.
    if ("getAll" in store) {
      const allCookies = store.getAll()
      const scopedProof = allCookies.find(({ name, value }) => {
        if (!name.startsWith(`${COOKIE_NAME}-`)) return false
        const attemptId = name.slice(`${COOKIE_NAME}-`.length)
        if (!attemptId) return false
        if (!validProof(value, attemptId)) return false
        matchedAttemptId = attemptId
        return true
      })
      const valid = validProof(store.get(COOKIE_NAME)?.value)
      if (valid || scopedProof) return matchedAttemptId
    } else if (await hasValidGoogleSignupProof()) {
      return undefined
    }
  } catch {
    // Treat cookie-store/configuration failures as a missing proof below.
  }
  await trackGoogleSignupBypass()
  throw new Error("Google signup verification required")
}

async function trackGoogleSignupBypass(): Promise<void> {
  await trackEvent(
    AUTH_EVENTS.GOOGLE_SIGNUP_BYPASS_BLOCKED,
    crypto.randomUUID(),
    { reason: "missing_or_invalid_proof", scope: "first_team_provisioning" },
  )
  console.warn("Google signup onboarding blocked: missing or invalid proof")
}

export async function consumeGoogleSignupProof(
  distinctId: string = crypto.randomUUID(),
  signupAttemptId?: string,
): Promise<void> {
  const store = await cookies()
  if (signupAttemptId) {
    store.delete(cookieName(signupAttemptId))
    store.delete(PENDING_ATTEMPT_COOKIE)
  } else if ("getAll" in store) {
    const allCookies = store.getAll()
    // Legacy, unscoped proofs have no attempt ID; consume only that proof.
    if (allCookies.some(({ name }) => name === COOKIE_NAME)) {
      store.delete(COOKIE_NAME)
    } else {
      // Preserve other concurrent attempts. For legacy callers without an ID,
      // consume at most one valid attempt-scoped proof rather than all of them.
      const proofCookie = allCookies.find(({ name, value }) => {
        if (!name.startsWith(`${COOKIE_NAME}-`)) return false
        const attemptId = name.slice(`${COOKIE_NAME}-`.length)
        return validProof(value, attemptId)
      })
      if (proofCookie) store.delete(proofCookie.name)
    }
  } else {
    // Keep compatibility with cookie-store implementations that predate getAll.
    const legacyStore = store as unknown as {
      get(name: string): { value: string } | undefined
      delete(name: string): void
    }
    if (legacyStore.get(COOKIE_NAME)) {
      legacyStore.delete(COOKIE_NAME)
    }
  }
  await trackEvent(AUTH_EVENTS.GOOGLE_SIGNUP_PROOF_CONSUMED, distinctId, {
    scope: "first_team_provisioning",
  })
  console.info("Google signup proof consumed after first team provisioning")
}

export function isGoogleUser(user: {
  app_metadata?: { provider?: string; providers?: string[] }
}): boolean {
  return (
    user.app_metadata?.provider === "google" ||
    user.app_metadata?.providers?.includes("google") === true
  )
}
