# JWT Auth + API Key Prefix Migration

## Summary

Migrate CLI login from API-key-based auth to Supabase JWT auth with refresh tokens. Rename API key prefix from `rayai_` to `superserve_`. Rename custom header from `X-RayAI-API-Key` to `X-Superserve-API-Key`.

## Goals

1. `superserve login` uses Supabase JWTs with 7-day default expiration
2. Same token works everywhere: CLI, playground, console, SDK
3. API keys (`superserve_` prefix) remain for programmatic SDK/REST access
4. Remove all `rayai` branding from auth-facing code

## Auth Model After Migration

| Client | Auth Method | Token Type | Expiry |
|--------|-----------|------------|--------|
| CLI (`superserve login`) | Device code flow → Supabase session | Supabase JWT + refresh token | ~1h (auto-refresh) |
| Dashboard / Console | Supabase Auth (browser session) | Supabase JWT + refresh token | ~1h (auto-refresh) |
| SDK / REST API | API key | `superserve_` + 32 hex chars | No expiry (revocable) |

## Design

### 1. Device Flow Returns Supabase Tokens

Currently, `poll_device_token()` in `auth_service.py` creates an API key. After migration, it creates a new Supabase session.

**`auth_service.py` changes:**

- Replace `_create_api_key(user_id)` with `_create_supabase_session(user_id)`
- New method uses Supabase Admin API (with service role key) to generate a magic link for the user, then exchanges it for a session
- Returns `DeviceTokenResponse` with `access_token` (Supabase JWT), `refresh_token`, `expires_in`, `expires_at`

**`config.py` changes:**

- Add `supabase_jwt_secret: str = ""` for potential direct token minting

**`DeviceTokenResponse` changes (`schemas/auth.py`):**

- `access_token` now contains a Supabase JWT (was API key)
- `refresh_token` is now always populated
- `expires_in` is set (was `None`)
- `expires_at` is set (was `None`)
- Update docstring from "API key" to "Supabase JWT"

### 2. API Key Prefix: `rayai_` → `superserve_`

**Files (platform API):**

| File | Change |
|------|--------|
| `services/auth_service.py:161` | `f"rayai_..."` → `f"superserve_..."` |
| `routes/api_keys.py:48-55` | Same prefix change in `generate_api_key()` |
| `middleware/auth.py:24` | Header: `X-RayAI-API-Key` → `X-Superserve-API-Key` |
| `middleware/auth.py:213` | Prefix check: `rayai_` → `superserve_` |
| `main.py:121` | CORS header rename |
| `schemas/auth.py:12` | Client ID: `rayai-cli` → `superserve-cli` |
| `scripts/mint_jwt_token.py:29` | Issuer: `rayai-platform` → `superserve-platform` |

**Files (platform frontend):**

| File | Change |
|------|--------|
| `app/(dashboard)/api-keys/page.tsx:190` | Display prefix |
| `app/(dashboard)/api-keys/page.tsx:211` | "RayAI API keys" → "Superserve API keys" |

**Test files:**

| File | Change |
|------|--------|
| `tests/conftest.py:17` | `rayai_test...` → `superserve_test...` |
| `tests/test_auth.py:263-264` | Prefix assertion + length (43 = `superserve_` + 32) |

**Backwards compatibility:** Existing `rayai_` keys are stored as SHA-256 hashes. They continue to work since hash lookup is prefix-agnostic. The prefix check in middleware should accept both `rayai_` and `superserve_` during a transition period.

### 3. CLI Changes

**`packages/cli/src/commands/login.ts`:**

- Device flow saves `{ token, expires_at, refresh_token }` from response
- Remove `loginWithApiKey()` — API keys are for SDK use, not CLI login
- Keep `--api-key` flag but print deprecation warning

**`packages/cli/src/config/auth.ts`:**

- Add `isTokenExpired()`: checks `expires_at` against current time (with 30s buffer)
- Add `refreshToken()`: calls Supabase `POST /auth/v1/token?grant_type=refresh_token`, saves new credentials
- `getCredentials()`: auto-refresh if expired

**`packages/cli/src/api/client.ts`:**

- `getHeaders()`: before returning, check if token is expired → auto-refresh
- Supabase URL needed for refresh endpoint — add to constants or derive from platform URL

**`packages/cli/src/api/types.ts`:**

- `Credentials` type already has `expires_at` and `refresh_token` — no schema changes needed

### 4. Auth Middleware Updates

**`middleware/auth.py` — `get_current_user()` dispatch:**

```
1. Check X-Superserve-API-Key header → validate_api_key()
2. Check Authorization: Bearer <token>:
   a. Starts with "superserve_" (or "rayai_" during transition) → validate_api_key()
   b. Contains dots (JWT) → validate_jwt() via JWKS (works for both dashboard + CLI tokens)
   c. Otherwise → validate_api_key()
```

No changes to `validate_jwt()` — both dashboard and CLI tokens are Supabase JWTs validated via JWKS.

### 5. Additional `rayai` References (Not Auth-Facing, Separate Cleanup)

These are out of scope for this migration but noted for future cleanup:

- `config.py:35` — `gcs_bucket: str = "rayai-deployments"` (infra)
- Frontend UI text referencing "RayAI" in quickstart, terms, headers
- Infra Pulumi component namespaces (`rayai:infra:*`)
- Code comments referencing "rayai package"

## Out of Scope

- Refresh token rotation/revocation server-side
- API key expiration
- Migration of existing `rayai_` keys (they continue to work via hash lookup)
- Frontend `rayai` branding cleanup beyond API key pages
