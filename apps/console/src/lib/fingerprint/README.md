# Fingerprint signup evaluation

SS-467 adds observe-only Fingerprint telemetry to the signup flow. It must remain fail-open and must not be used to allow, deny, challenge, or quarantine a signup.

Configure `NEXT_PUBLIC_FINGERPRINT_API_KEY` for the browser agent and `FINGERPRINT_SECRET_API_KEY` for trusted server-side event lookup. `FINGERPRINT_SERVER_API_URL` defaults to the global Fingerprint Server API and can be overridden for regional workspaces.

Normalized observations are emitted as the server-side PostHog event `auth_fingerprint_signup_observed`. Controlled browser/device correlation scenarios are intentionally evaluated manually for this provider trial.
