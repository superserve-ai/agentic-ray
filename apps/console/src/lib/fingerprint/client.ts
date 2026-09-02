import { FINGERPRINT_SIGNUP_COOKIE } from "./constants"

const FINGERPRINT_SIGNUP_COOKIE_MAX_AGE_SECONDS = 600
type FingerprintGetData = () => Promise<{ event_id?: string }>
let fingerprintGetData: FingerprintGetData | undefined

export function registerFingerprintGetData(getData: FingerprintGetData) {
  fingerprintGetData = getData
}

export function readFingerprintSignupEventIdCookie(): string | undefined {
  if (typeof document === "undefined") return undefined

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${FINGERPRINT_SIGNUP_COOKIE}=`))

  if (!cookie) return undefined

  const encodedEventId = cookie.slice(FINGERPRINT_SIGNUP_COOKIE.length + 1)
  try {
    return decodeURIComponent(encodedEventId)
  } catch {
    return undefined
  }
}

export function writeFingerprintSignupEventIdCookie(eventId: string) {
  if (typeof window === "undefined") return

  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${FINGERPRINT_SIGNUP_COOKIE}=${encodeURIComponent(eventId)}; Path=/; Max-Age=${FINGERPRINT_SIGNUP_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
}

/**
 * Resolve the Fingerprint signup request ID early enough for the server action
 * to observe it, and persist the opaque ID into the short-lived cookie used by
 * the signup action.
 */
export function ensureFingerprintSignupEventId(): Promise<string | undefined> {
  const cachedEventId = readFingerprintSignupEventIdCookie()
  if (cachedEventId || !fingerprintGetData)
    return Promise.resolve(cachedEventId)

  return fingerprintGetData()
    .then((result) => {
      if (result.event_id) writeFingerprintSignupEventIdCookie(result.event_id)
      return result.event_id
    })
    .catch(() => undefined)
}
