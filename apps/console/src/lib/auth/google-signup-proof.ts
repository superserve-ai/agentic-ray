import crypto from "node:crypto"

import { cookies } from "next/headers"

import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"

const COOKIE_NAME = "__Host-superserve-google-signup"
const PURPOSE = "signup_google"
const VERSION = 1
const TTL_SECONDS = 5 * 60

interface ProofPayload {
  v: number
  purpose: string
  exp: number
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

function encodeProof(): string {
  const payload: ProofPayload = {
    v: VERSION,
    purpose: PURPOSE,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${encoded}.${signature(encoded).toString("base64url")}`
}

function validProof(value: string | undefined): boolean {
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
      payload.exp >= Math.floor(Date.now() / 1000)
    )
  } catch {
    return false
  }
}

export async function issueGoogleSignupProof(): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, encodeProof(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  })
}

export async function hasValidGoogleSignupProof(): Promise<boolean> {
  try {
    const store = await cookies()
    return validProof(store.get(COOKIE_NAME)?.value)
  } catch (error) {
    console.error("Google signup proof validation failed", error)
    return false
  }
}

export async function requireGoogleSignupProof(): Promise<void> {
  if (!(await hasValidGoogleSignupProof())) {
    await trackEvent(
      AUTH_EVENTS.GOOGLE_SIGNUP_BYPASS_BLOCKED,
      crypto.randomUUID(),
      { reason: "missing_or_invalid_proof", scope: "first_team_provisioning" },
    )
    console.warn("Google signup onboarding blocked: missing or invalid proof")
    throw new Error("Google signup verification required")
  }
}

export async function consumeGoogleSignupProof(
  distinctId: string = crypto.randomUUID(),
): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
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
