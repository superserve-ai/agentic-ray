import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: vi.fn(),
}))

import { trackEvent } from "@/lib/posthog/actions"

import { observeFingerprintSignup } from "./observe"

const originalSecret = process.env.FINGERPRINT_SECRET_API_KEY

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(trackEvent).mockClear()
  if (originalSecret === undefined) {
    delete process.env.FINGERPRINT_SECRET_API_KEY
  } else {
    process.env.FINGERPRINT_SECRET_API_KEY = originalSecret
  }
})

describe("observeFingerprintSignup", () => {
  it("is a no-op when Fingerprint is not configured", async () => {
    delete process.env.FINGERPRINT_SECRET_API_KEY
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(
      observeFingerprintSignup({ eventId: "event-1", signupMethod: "email" }),
    ).resolves.toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it("fails open when the Server API request fails", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))

    await expect(
      observeFingerprintSignup({ eventId: "event-1", signupMethod: "google" }),
    ).resolves.toBeUndefined()

    expect(trackEvent).not.toHaveBeenCalled()
  })

  it("records trusted server-side v4 identification data", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          event_id: "event-1",
          identification: {
            visitor_id: "visitor-1",
            visitor_found: true,
            confidence: 0.99,
          },
          vpn: true,
          vpn_confidence: "high",
          vpn_methods: { public_vpn: true, relay: false },
          proxy: true,
          proxy_details: { proxy_type: "residential" },
          ip_blocklist: { tor_node: false, attack_source: false },
          high_activity_device: true,
          tampering: false,
          developer_tools: true,
          virtual_machine: false,
          virtual_machine_ml_score: 0.12,
          incognito: false,
          privacy_settings: true,
          rare_device: true,
          rare_device_percentile_bucket: "p99.9+",
          bot: "not_detected",
          velocity: {
            distinct_ip: { "5_minutes": 2, "1_hour": 4, "24_hours": 8 },
            distinct_country: { "5_minutes": 1, "1_hour": 2, "24_hours": 3 },
            events: { "5_minutes": 3, "1_hour": 5, "24_hours": 9 },
            ip_events: { "5_minutes": 2, "1_hour": 6, "24_hours": 10 },
          },
        }),
        { status: 200 },
      ),
    )

    await observeFingerprintSignup({
      eventId: "event-1",
      userId: "user-1",
      signupMethod: "email",
    })

    expect(fetch).toHaveBeenCalledWith(
      "https://api.fpjs.io/v4/events/event-1",
      expect.objectContaining({
        headers: { Authorization: "Bearer server-secret" },
      }),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      "auth_fingerprint_signup_observed",
      "user-1",
      expect.objectContaining({
        provider: "fingerprint",
        provider_event_id: "event-1",
        visitor_id: "visitor-1",
        visitor_found: true,
        confidence_score: 0.99,
        vpn: true,
        smart_signals: expect.objectContaining({
          vpn: true,
          proxy: true,
          high_activity_device: true,
          tampering: false,
          developer_tools: true,
          virtual_machine: false,
          virtual_machine_ml_score: 0.12,
          bot: "not_detected",
          incognito: false,
          privacy_settings: true,
          rare_device: true,
          rare_device_percentile_bucket: "p99.9+",
          geolocation_spoofing: null,
          velocity: {
            distinct_ip: { "5m": 2, "1h": 4, "24h": 8 },
            distinct_country: { "5m": 1, "1h": 2, "24h": 3 },
            events: { "5m": 3, "1h": 5, "24h": 9 },
            ip_events: { "5m": 2, "1h": 6, "24h": 10 },
          },
        }),
        superserve_user_id: "user-1",
      }),
    )
  })

  it("fails open for malformed or unrelated server responses", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          event_id: "other-event",
          identification: {},
          vpn: true,
        }),
        { status: 200 },
      ),
    )

    await expect(
      observeFingerprintSignup({ eventId: "event-1", signupMethod: "email" }),
    ).resolves.toBeUndefined()

    expect(trackEvent).not.toHaveBeenCalled()
  })
})
