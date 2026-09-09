# SS-468 Cloudflare capability status

The console integration runs Free Turnstile observe-only alongside reCAPTCHA.
The browser obtains a Turnstile token, the Superserve server sends it to
Cloudflare Siteverify, and the normalized response is stored under the shared
`signup_attempt_id`. Turnstile never affects signup allow/deny decisions.

Superserve is currently on Cloudflare Free. Enterprise Turnstile, Ephemeral
IDs, Account Abuse Protection, and Bot Management are not self-serve on this
plan. Cloudflare Enterprise POC access is being pursued in parallel; until it
is granted, `metadata.ephemeral_id` and account-abuse fields remain nullable.

The Turnstile secret and site key must be configured in Vercel for the console
deployment. Turbo's build allowlist includes both variables so the browser key
and server secret reach the correct build/runtime environments.
