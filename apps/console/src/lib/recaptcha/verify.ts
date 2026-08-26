type AssessmentResponse = {
  tokenProperties?: {
    valid?: boolean
    invalidReason?: string
    action?: string
  }
  riskAnalysis?: {
    score?: number
  }
}

const DEFAULT_SCORE_THRESHOLD = 0.5
const ASSESSMENT_TIMEOUT_MS = 5000
// reCAPTCHA Enterprise tokens are a few hundred to ~2000 chars in practice;
// this is a generous cap that still rejects a deliberately oversized string
// before it reaches Google (rather than relying on their 4xx for that).
const MAX_TOKEN_LENGTH = 4096

const getScoreThreshold = (): number => {
  const raw = process.env.RECAPTCHA_SCORE_THRESHOLD?.trim()
  if (!raw) return DEFAULT_SCORE_THRESHOLD
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_SCORE_THRESHOLD
  }
  return parsed
}

// reCAPTCHA Enterprise. Fails open (treats the request as verified) whenever
// the integration itself isn't configured or errors, so a misconfigured or
// unreachable check never blocks real signups.
export const verifyRecaptcha = async (
  // Server actions expose an RPC endpoint with no runtime type enforcement —
  // a caller can send any JSON, not just what the TS signature promises.
  token: unknown,
  expectedAction: string,
): Promise<{ verified: true } | { verified: false; reason: string }> => {
  const apiKey = process.env.RECAPTCHA_API_KEY
  const projectId = process.env.RECAPTCHA_PROJECT_ID
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

  if (!apiKey || !projectId || !siteKey) {
    return { verified: true }
  }

  if (typeof token !== "string" || !token) {
    return { verified: false, reason: "missing_token" }
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    return { verified: false, reason: "token_too_long" }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ASSESSMENT_TIMEOUT_MS)
  try {
    const response = await fetch(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: { token, siteKey, expectedAction } }),
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      console.error(
        "reCAPTCHA assessment request failed",
        response.status,
        await response.text(),
      )
      // A malformed/forged token still gets a 200 with tokenProperties.valid
      // === false (handled below) — Google validates token content inside a
      // successful assessment, and the one HTTP-level bypass (an oversized
      // token) is already rejected above by MAX_TOKEN_LENGTH. A non-OK
      // response here means the *request* was rejected for a reason we
      // don't control (bad API key, wrong project, site key/project
      // mismatch, quota) — fail open so a config mistake degrades to "no
      // CAPTCHA" rather than "no signups."
      return { verified: true }
    }

    const data: AssessmentResponse = await response.json()
    if (!data.tokenProperties?.valid) {
      return {
        verified: false,
        reason: data.tokenProperties?.invalidReason || "invalid_token",
      }
    }
    if (data.tokenProperties.action !== expectedAction) {
      return { verified: false, reason: "action_mismatch" }
    }

    // riskAnalysis.score is a proto3 float: a genuine 0.0 (worst score) can
    // be omitted from the JSON entirely, so treat a missing score the same
    // as the lowest possible score rather than skipping the check.
    const score = data.riskAnalysis?.score
    if (typeof score !== "number" || score < getScoreThreshold()) {
      return {
        verified: false,
        reason:
          typeof score === "number" ? `low_score:${score}` : "missing_score",
      }
    }

    return { verified: true }
  } catch (err) {
    console.error("reCAPTCHA verification error", err)
    return { verified: true }
  } finally {
    clearTimeout(timeout)
  }
}
