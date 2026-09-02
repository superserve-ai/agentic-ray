import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"

const FINGERPRINT_EVENT_TIMEOUT_MS = 1500
const DEFAULT_FINGERPRINT_SERVER_API = "https://api.fpjs.io"

export type FingerprintSignupObservation = {
  eventId: string
  userId?: string | null
  signupMethod: "email" | "google"
}

type FingerprintNormalizedEvent = {
  providerEventId: string
  visitorId: string
  visitorFound: boolean | null
  confidenceScore: number | null
  botResult: string | null
  botType: string | null
  vpn: boolean | null
  vpnConfidence: string | null
  proxy: boolean | null
  proxyConfidence: string | null
  incognito: boolean | null
  tampering: boolean | null
  tamperingConfidence: string | null
  virtualMachine: boolean | null
  developerTools: boolean | null
  highActivityDevice: boolean | null
  suspectScore: number | null
  smartSignals: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function normalizeVelocityMetric(value: unknown) {
  const metric = recordOrNull(value)
  if (!metric) return null
  return {
    "5m": numberOrNull(metric["5_minutes"]),
    "1h": numberOrNull(metric["1_hour"]),
    "24h": numberOrNull(metric["24_hours"]),
  }
}

function normalizeFingerprintEvent(
  payload: unknown,
  requestedEventId: string,
): FingerprintNormalizedEvent | null {
  if (!isRecord(payload)) return null
  const providerEventId = stringOrNull(payload.event_id)
  if (!providerEventId || providerEventId !== requestedEventId) return null

  const identification = isRecord(payload.identification)
    ? payload.identification
    : null
  const visitorId = stringOrNull(identification?.visitor_id)
  if (!visitorId) return null

  const confidence = isRecord(identification?.confidence)
    ? identification.confidence
    : null
  const ipBlocklist = recordOrNull(payload.ip_blocklist)
  const proxyDetails = recordOrNull(payload.proxy_details)
  const vpnMethods = recordOrNull(payload.vpn_methods)
  const tamperingDetails = recordOrNull(payload.tampering_details)
  const velocity = recordOrNull(payload.velocity)
  const smartSignals = {
    vpn: booleanOrNull(payload.vpn),
    vpn_confidence: stringOrNull(payload.vpn_confidence),
    vpn_ml_score: numberOrNull(payload.vpn_ml_score),
    vpn_origin_timezone: stringOrNull(payload.vpn_origin_timezone),
    vpn_origin_country: stringOrNull(payload.vpn_origin_country),
    vpn_methods: vpnMethods
      ? {
          timezone_mismatch: booleanOrNull(vpnMethods.timezone_mismatch),
          public_vpn: booleanOrNull(vpnMethods.public_vpn),
          auxiliary_mobile: booleanOrNull(vpnMethods.auxiliary_mobile),
          os_mismatch: booleanOrNull(vpnMethods.os_mismatch),
          relay: booleanOrNull(vpnMethods.relay),
          ml_prediction: booleanOrNull(vpnMethods.ml_prediction),
        }
      : null,
    proxy: booleanOrNull(payload.proxy),
    proxy_confidence: stringOrNull(payload.proxy_confidence),
    proxy_ml_score: numberOrNull(payload.proxy_ml_score),
    proxy_details: proxyDetails
      ? {
          proxy_type: stringOrNull(proxyDetails.proxy_type),
          last_seen_at: stringOrNull(proxyDetails.last_seen_at),
        }
      : null,
    ip_blocklist: ipBlocklist
      ? {
          email_spam: booleanOrNull(ipBlocklist.email_spam),
          attack_source: booleanOrNull(ipBlocklist.attack_source),
          tor_node: booleanOrNull(ipBlocklist.tor_node),
        }
      : null,
    tor: booleanOrNull(payload.tor) ?? booleanOrNull(ipBlocklist?.tor_node),
    high_activity_device: booleanOrNull(payload.high_activity_device),
    tampering: booleanOrNull(payload.tampering),
    tampering_confidence: stringOrNull(payload.tampering_confidence),
    tampering_ml_score: numberOrNull(payload.tampering_ml_score),
    tampering_details: tamperingDetails
      ? { anomaly_score: numberOrNull(tamperingDetails.anomaly_score) }
      : null,
    developer_tools: booleanOrNull(payload.developer_tools),
    virtual_machine: booleanOrNull(payload.virtual_machine),
    virtual_machine_ml_score: numberOrNull(payload.virtual_machine_ml_score),
    bot: stringOrNull(payload.bot),
    bot_type: stringOrNull(payload.bot_type),
    incognito: booleanOrNull(payload.incognito),
    privacy_settings: booleanOrNull(payload.privacy_settings),
    rare_device: booleanOrNull(payload.rare_device),
    rare_device_percentile_bucket: stringOrNull(
      payload.rare_device_percentile_bucket,
    ),
    geolocation_spoofing: booleanOrNull(payload.geolocation_spoofing),
    velocity: velocity
      ? {
          distinct_ip: normalizeVelocityMetric(velocity.distinct_ip),
          distinct_country: normalizeVelocityMetric(velocity.distinct_country),
          events: normalizeVelocityMetric(velocity.events),
          ip_events: normalizeVelocityMetric(velocity.ip_events),
        }
      : null,
  }

  return {
    providerEventId,
    visitorId,
    visitorFound: booleanOrNull(identification?.visitor_found),
    confidenceScore:
      numberOrNull(identification?.confidence) ??
      numberOrNull(confidence?.score),
    botResult: stringOrNull(payload.bot),
    botType: stringOrNull(payload.bot_type),
    vpn: booleanOrNull(payload.vpn),
    vpnConfidence: stringOrNull(payload.vpn_confidence),
    proxy: booleanOrNull(payload.proxy),
    proxyConfidence: stringOrNull(payload.proxy_confidence),
    incognito: booleanOrNull(payload.incognito),
    tampering: booleanOrNull(payload.tampering),
    tamperingConfidence: stringOrNull(payload.tampering_confidence),
    virtualMachine: booleanOrNull(payload.virtual_machine),
    developerTools: booleanOrNull(payload.developer_tools),
    highActivityDevice: booleanOrNull(payload.high_activity_device),
    suspectScore: numberOrNull(payload.suspect_score),
    smartSignals,
  }
}

/**
 * Resolve a browser-generated Fingerprint event using the trusted Server API
 * and record an observe-only signup event. This helper is deliberately
 * fail-open: Fingerprint is evaluation telemetry and must never become a
 * signup availability dependency.
 */
export async function observeFingerprintSignup({
  eventId,
  userId = null,
  signupMethod,
}: FingerprintSignupObservation): Promise<void> {
  const secretApiKey = process.env.FINGERPRINT_SECRET_API_KEY
  if (!secretApiKey || !eventId) return

  const baseUrl =
    process.env.FINGERPRINT_SERVER_API_URL || DEFAULT_FINGERPRINT_SERVER_API

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/v4/events/${encodeURIComponent(eventId)}`,
      {
        headers: { Authorization: `Bearer ${secretApiKey}` },
        signal: AbortSignal.timeout(FINGERPRINT_EVENT_TIMEOUT_MS),
        cache: "no-store",
      },
    )

    if (!response.ok) {
      console.warn("Fingerprint observation lookup failed", {
        eventId,
        status: response.status,
      })
      return
    }

    const event = normalizeFingerprintEvent(await response.json(), eventId)
    if (!event) {
      console.warn("Fingerprint observation response was malformed", {
        eventId,
      })
      return
    }

    console.info("Fingerprint observation lookup succeeded", {
      eventId: event.providerEventId,
      visitorId: event.visitorId,
    })

    await trackEvent(
      AUTH_EVENTS.FINGERPRINT_SIGNUP_OBSERVED,
      userId || eventId,
      {
        provider: "fingerprint",
        provider_event_id: event.providerEventId,
        visitor_id: event.visitorId,
        visitor_found: event.visitorFound,
        confidence_score: event.confidenceScore,
        bot_result: event.botResult,
        bot_type: event.botType,
        vpn: event.vpn,
        vpn_confidence: event.vpnConfidence,
        proxy: event.proxy,
        proxy_confidence: event.proxyConfidence,
        incognito: event.incognito,
        tampering: event.tampering,
        tampering_confidence: event.tamperingConfidence,
        virtual_machine: event.virtualMachine,
        developer_tools: event.developerTools,
        high_activity_device: event.highActivityDevice,
        suspect_score: event.suspectScore,
        smart_signals: event.smartSignals,
        superserve_user_id: userId,
        signup_method: signupMethod,
        observed_at: new Date().toISOString(),
      },
    )
  } catch (error) {
    console.warn("Fingerprint observation failed open", {
      eventId,
      error: error instanceof Error ? error.message : "unknown_error",
    })
  }
}
