import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createAdminClient } from "@/lib/supabase/admin"

const TIMEOUT_MS = 1500
const FLAG_TIMEOUT_MS = 750
const FLAG_KEY = "cloudflare_signup_observation"

export type CloudflareSignupObservation = {
  signupAttemptId: string
  signupMethod: "email" | "google"
  userId?: string | null
  teamId?: string | null
  turnstileToken?: string | null
  clientContext?: { ip?: string | null }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

async function flagState(): Promise<boolean | null> {
  try {
    const lookup = createAdminClient().rpc("feature_enabled", {
      flag_key: FLAG_KEY,
      flag_team_id: null,
    })
    const { data, error } = await Promise.race([
      lookup,
      new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(
          () => resolve({ data: null, error: new Error("flag_timeout") }),
          FLAG_TIMEOUT_MS,
        ),
      ),
    ])
    return error ? null : Boolean(data)
  } catch {
    return null
  }
}

export async function isCloudflareSignupObservationEnabled(): Promise<boolean> {
  return (await flagState()) === true
}

function safeSignals(value: unknown): Record<string, unknown> {
  if (!record(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, val]) =>
        /token|secret|cookie|authorization|password|credential/i.test(key)
          ? false
          : ["string", "number", "boolean"].includes(typeof val),
      )
      .slice(0, 40),
  )
}

function siteverifyOutcome(data: Record<string, unknown>): string {
  if (data.success === true) return "success"
  const codes = Array.isArray(data["error-codes"]) ? data["error-codes"] : []
  const providerCodes = new Set([
    "invalid-input-secret",
    "missing-input-secret",
    "internal-error",
  ])
  return codes.some(
    (code) => typeof code === "string" && providerCodes.has(code),
  )
    ? "provider_error"
    : "rejected"
}

export async function observeCloudflareSignup({
  signupAttemptId,
  signupMethod,
  userId = null,
  teamId = null,
  turnstileToken,
  clientContext,
}: CloudflareSignupObservation): Promise<void> {
  if (!signupAttemptId) return
  const configVersion = process.env.CLOUDFLARE_SIGNUP_CONFIG_VERSION || "v1"
  const capabilities = (
    process.env.CLOUDFLARE_SIGNUP_CAPABILITIES || "turnstile_free"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20)
  const enabled = await flagState()
  if (enabled === null) {
    await trackEvent(
      AUTH_EVENTS.CLOUDFLARE_SIGNUP_OBSERVATION_FAILED,
      signupAttemptId,
      {
        provider: "cloudflare",
        signup_attempt_id: signupAttemptId,
        signup_method: signupMethod,
        provider_outcome: "configuration_lookup_failed",
        config_version: configVersion,
        observed_at: new Date().toISOString(),
      },
    )
    return
  }
  if (!enabled) return

  const started = Date.now()
  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY
  let outcome = "success"
  let responseData: Record<string, unknown> = {}
  if (!secret || !turnstileToken) {
    outcome = !secret ? "unconfigured" : "missing_token"
  } else {
    try {
      const response = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            secret,
            response: turnstileToken,
            ...(clientContext?.ip ? { remoteip: clientContext.ip } : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        },
      )
      if (!response.ok) outcome = `http_${response.status}`
      else {
        const json: unknown = await response.json()
        if (!record(json)) outcome = "malformed"
        else {
          responseData = json
          outcome = siteverifyOutcome(json)
        }
      }
    } catch (error) {
      outcome =
        error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "error"
    }
  }

  const metadata = record(responseData.metadata) ? responseData.metadata : {}
  console.info("Cloudflare signup observation outcome", {
    signup_attempt_id: signupAttemptId,
    provider_outcome: outcome,
    success:
      typeof responseData.success === "boolean" ? responseData.success : null,
    hostname:
      typeof responseData.hostname === "string" ? responseData.hostname : null,
    provider_latency_ms: Date.now() - started,
  })
  await trackEvent(
    AUTH_EVENTS.CLOUDFLARE_SIGNUP_OBSERVED,
    userId || signupAttemptId,
    {
      provider: "cloudflare",
      signup_attempt_id: signupAttemptId,
      provider_request_id:
        responseData.request_id ?? responseData.event_id ?? null,
      challenge_timestamp: responseData.challenge_ts ?? null,
      action: responseData.action ?? null,
      hostname: responseData.hostname ?? null,
      cdata: responseData.cdata ?? null,
      ephemeral_id: metadata.ephemeral_id ?? null,
      success: responseData.success ?? null,
      error_codes: Array.isArray(responseData["error-codes"])
        ? responseData["error-codes"].slice(0, 20)
        : [],
      capabilities,
      config_version: configVersion,
      signup_method: signupMethod,
      superserve_user_id: userId,
      team_id: teamId,
      provider_latency_ms: Date.now() - started,
      provider_outcome: outcome,
      provider_signals: safeSignals(responseData),
      observed_at: new Date().toISOString(),
    },
  )
}
