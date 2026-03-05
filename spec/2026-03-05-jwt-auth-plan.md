# JWT Auth + API Key Prefix Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate CLI login from API-key-based auth to Supabase JWT auth with refresh tokens, rename API key prefix from `rayai_` to `superserve_`, rename custom header from `X-RayAI-API-Key` to `X-Superserve-API-Key`.

**Architecture:** The device flow will return Supabase access_token + refresh_token instead of an API key. The platform uses the Supabase Admin API (service role key) to generate a new session for the CLI user. API keys remain for programmatic SDK/REST access with the new `superserve_` prefix.

**Tech Stack:** Python/FastAPI (platform API), TypeScript/Bun (CLI), Supabase Auth, httpx

**Repos:**
- `superserve` (this repo): `/Users/nirnejak/Code/superserve/superserve/`
- `platform` (separate repo): `/Users/nirnejak/Code/superserve/platform/`

---

### Task 1: Rename API key prefix in platform API key generation

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/platform/api/app/routes/api_keys.py:48-55`
- Modify: `/Users/nirnejak/Code/superserve/platform/api/app/services/auth_service.py:161`

**Step 1: Update `generate_api_key()` in routes**

In `/Users/nirnejak/Code/superserve/platform/api/app/routes/api_keys.py`, change:

```python
def generate_api_key() -> str:
    """Generate a secure random API key.

    Format: superserve_<32 random hex characters>
    Example: superserve_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
    """
    random_part = secrets.token_hex(16)  # 32 hex characters
    return f"superserve_{random_part}"
```

**Step 2: Update `_create_api_key()` in auth service**

In `/Users/nirnejak/Code/superserve/platform/api/app/services/auth_service.py:161`, change:

```python
raw_key = f"superserve_{secrets.token_hex(16)}"
```

**Step 3: Verify tests still pass (they test format, will update in Task 3)**

Run: `cd /Users/nirnejak/Code/superserve/platform && uv run pytest api/tests/test_auth.py -v`
Expected: `test_create_api_key_format` will FAIL (expected prefix changed) — this is expected, we fix in Task 3.

---

### Task 2: Rename header and update middleware prefix detection

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/platform/api/app/middleware/auth.py:24,77-82,197-227`
- Modify: `/Users/nirnejak/Code/superserve/platform/api/main.py:121`

**Step 1: Rename API key header**

In `/Users/nirnejak/Code/superserve/platform/api/app/middleware/auth.py:24`, change:

```python
api_key_header = APIKeyHeader(name="X-Superserve-API-Key", auto_error=False)
```

**Step 2: Update prefix detection in `get_current_user()` to accept both old and new prefixes**

In `/Users/nirnejak/Code/superserve/platform/api/app/middleware/auth.py:193-227`, replace `get_current_user` with:

```python
async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(http_bearer),
    api_key: str | None = Depends(api_key_header),
) -> UserInfo:
    """Get the current authenticated user.

    Supports three authentication methods:
    1. X-Superserve-API-Key header
    2. Authorization: Bearer <jwt_token>
    3. Authorization: Bearer <api_key> (API key in bearer format)
    """
    # Try API key header first
    if api_key:
        return await validate_api_key(api_key)

    # Try Bearer token
    if credentials:
        token = credentials.credentials

        # Check if this looks like an API key (superserve_ or legacy rayai_ prefix)
        if token.startswith("superserve_") or token.startswith("rayai_"):
            return await validate_api_key(token)

        # If token contains dots, it's a JWT — validate as JWT only (no fallback)
        if "." in token:
            return await validate_jwt(token)

        # Non-JWT, non-prefixed token — try as API key
        return await validate_api_key(token)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required. Provide API key or Bearer token.",
        headers={"WWW-Authenticate": "Bearer"},
    )
```

**Step 3: Update `validate_jwt` docstring**

In `/Users/nirnejak/Code/superserve/platform/api/app/middleware/auth.py:76-82`, change the docstring to:

```python
async def validate_jwt(token: str) -> UserInfo:
    """Validate a Supabase JWT token and return user info.

    Tokens are verified via the Supabase JWKS endpoint (ES256/RS256).
    Both dashboard and CLI tokens are Supabase JWTs.
    """
```

**Step 4: Update CORS header in main.py**

In `/Users/nirnejak/Code/superserve/platform/api/main.py:121`, change:

```python
    allow_headers=["Authorization", "Content-Type", "X-Superserve-API-Key", "X-Run-ID"],
```

---

### Task 3: Update tests and fixtures for new prefix

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/platform/api/tests/conftest.py:14,17`
- Modify: `/Users/nirnejak/Code/superserve/platform/api/tests/test_auth.py:263-264`

**Step 1: Update test fixtures**

In `/Users/nirnejak/Code/superserve/platform/api/tests/conftest.py:14,17`, change:

```python
TEST_USER_EMAIL = "dev@superserve.local"
```

```python
TEST_API_KEY = "superserve_test000000000000000000"
```

Note: `superserve_test000000000000000000` is 11 + 32 = 43 chars total. The old key was `rayai_test0000000000000000000000` (6 + 32 = 38 chars). The new test key needs exactly 32 hex chars after the prefix, so: `superserve_` (11) + 32 hex = 43 total.

**Step 2: Update test assertions**

In `/Users/nirnejak/Code/superserve/platform/api/tests/test_auth.py:263-264`, change:

```python
            assert api_key.startswith("superserve_")
            assert len(api_key) == 43  # "superserve_" + 32 hex chars
```

**Step 3: Run tests to verify**

Run: `cd /Users/nirnejak/Code/superserve/platform && uv run pytest api/tests/test_auth.py -v`
Expected: All tests PASS.

---

### Task 4: Update auth schema and client ID

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/platform/api/app/schemas/auth.py:9-12,36-43`

**Step 1: Update client ID**

In `/Users/nirnejak/Code/superserve/platform/api/app/schemas/auth.py:12`, change:

```python
    client_id: str = Field(default="superserve-cli", description="Client identifier")
```

**Step 2: Update DeviceTokenResponse docstring**

In `/Users/nirnejak/Code/superserve/platform/api/app/schemas/auth.py:36-43`, change:

```python
class DeviceTokenResponse(BaseModel):
    """Response with access token (Supabase JWT) after successful auth."""

    access_token: str = Field(..., description="Supabase JWT for authentication")
    token_type: str = Field(default="Bearer", description="Token type")
    expires_in: int | None = Field(None, description="Seconds until token expires")
    expires_at: datetime | None = Field(None, description="Token expiration timestamp")
    refresh_token: str | None = Field(None, description="Supabase refresh token")
```

---

### Task 5: Update mint_jwt_token.py script

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/platform/api/scripts/mint_jwt_token.py:29`

**Step 1: Update issuer**

In `/Users/nirnejak/Code/superserve/platform/api/scripts/mint_jwt_token.py:29`, change:

```python
        "iss": "superserve-platform",
```

---

### Task 6: Add Supabase session creation to auth service

This is the core change: replace API key generation in the device flow with Supabase session creation.

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/platform/api/app/services/auth_service.py:1-27,78-128,155-173`
- Modify: `/Users/nirnejak/Code/superserve/platform/api/app/config.py:39-41`

**Step 1: Add `supabase_jwt_secret` to config**

In `/Users/nirnejak/Code/superserve/platform/api/app/config.py`, after line 41 (`device_code_expiry_minutes`), add:

```python
    # Supabase JWT secret for creating CLI sessions via Admin API
    supabase_jwt_secret: str = ""
```

**Step 2: Update auth_service.py module docstring**

Replace lines 1-6:

```python
"""Authentication service for device code flow.

Device auth flow issues Supabase JWTs via the Admin API. CLI clients receive
the same tokens as dashboard users for unified authentication.
"""
```

**Step 3: Add httpx import and `_create_supabase_session` method**

In `/Users/nirnejak/Code/superserve/platform/api/app/services/auth_service.py`, add `import httpx` after `import hashlib` (line 8).

Remove the imports that are no longer needed by `_create_api_key`:
- Remove: `from app.database.generated.api_keys import AsyncQuerier as ApiKeyQuerier`
- Remove: `from app.database.generated.api_keys import create_api_keyParams`

Replace `_create_api_key` method (lines 155-173) with:

```python
    async def _create_supabase_session(self, user_id: UUID) -> dict:
        """Create a Supabase session for a CLI client via Admin API.

        Uses the Supabase Admin API to generate a magic link, then exchanges
        it for access and refresh tokens. Returns dict with access_token,
        refresh_token, and expires_in.
        """
        admin_url = f"{settings.supabase_url}/auth/v1/admin/generate-link"
        headers = {
            "Authorization": f"Bearer {settings.supabase_key}",
            "apikey": settings.supabase_key,
            "Content-Type": "application/json",
        }

        # Get user email for the magic link
        profile = await self.profile_querier.get_profile(id=user_id)
        if not profile:
            raise ValueError(f"User {user_id} not found")

        async with httpx.AsyncClient() as client:
            # Generate a magic link via Admin API
            resp = await client.post(
                admin_url,
                headers=headers,
                json={
                    "type": "magiclink",
                    "email": profile.email,
                },
                timeout=10.0,
            )
            resp.raise_for_status()
            link_data = resp.json()

            # Extract the token hash from the action link
            # The link contains a token_hash and type parameter
            from urllib.parse import parse_qs, urlparse

            action_link = link_data.get("action_link", "")
            parsed = urlparse(action_link)
            query = parse_qs(parsed.fragment or parsed.query)

            token_hash = None
            # Try fragment first (Supabase PKCE flow)
            if parsed.fragment:
                fragment_params = parse_qs(parsed.fragment)
                token_hash = fragment_params.get("token_hash", [None])[0]
            if not token_hash:
                token_hash = query.get("token_hash", [None])[0]

            if not token_hash:
                raise ValueError("Failed to extract token from magic link")

            # Verify the OTP to get a session
            verify_url = f"{settings.supabase_url}/auth/v1/verify"
            verify_resp = await client.post(
                verify_url,
                headers={
                    "apikey": settings.supabase_key,
                    "Content-Type": "application/json",
                },
                json={
                    "type": "magiclink",
                    "token_hash": token_hash,
                },
                timeout=10.0,
            )
            verify_resp.raise_for_status()
            session_data = verify_resp.json()

            return {
                "access_token": session_data["access_token"],
                "refresh_token": session_data["refresh_token"],
                "expires_in": session_data.get("expires_in", 3600),
                "expires_at": session_data.get("expires_at"),
            }
```

**Step 4: Update `poll_device_token` to use the new method**

Replace lines 108-122 in `poll_device_token`:

```python
        # Check if authorized
        if record.status == "authorized" and record.user_id:
            # Create a Supabase session for the CLI client
            session = await self._create_supabase_session(record.user_id)

            # Mark device code as used (keep for audit trail)
            await self.device_code_querier.mark_device_code_used(device_code=device_code)

            expires_at = None
            if session.get("expires_at"):
                from datetime import timezone
                expires_at = datetime.fromtimestamp(session["expires_at"], tz=UTC)

            return DeviceTokenResponse(
                access_token=session["access_token"],
                token_type="Bearer",
                expires_in=session.get("expires_in"),
                expires_at=expires_at,
                refresh_token=session.get("refresh_token"),
            )
```

**Step 5: Update test for the changed method**

In `/Users/nirnejak/Code/superserve/platform/api/tests/test_auth.py`, the `TestAPIKeyCreation` class tests `_create_api_key`. These tests need to be updated to test `_create_supabase_session` instead, or removed since the Supabase Admin API interaction is better tested via integration tests.

Replace class `TestAPIKeyCreation` (lines 239-289) with:

```python
class TestSupabaseSessionCreation:
    """Test Supabase session creation in device auth flow."""

    @pytest.mark.asyncio
    async def test_create_supabase_session_calls_admin_api(self, test_user_id):
        """Test that session creation calls Supabase Admin API."""
        from uuid import UUID

        from app.services.auth_service import AuthService

        mock_conn = AsyncMock()

        # Mock profile lookup
        mock_profile = MagicMock()
        mock_profile.email = "test@example.com"

        with (
            patch("app.services.auth_service.ProfileQuerier") as mock_profile_class,
            patch("app.services.auth_service.httpx.AsyncClient") as mock_http_class,
        ):
            mock_profile_querier = MagicMock()
            mock_profile_querier.get_profile = AsyncMock(return_value=mock_profile)
            mock_profile_class.return_value = mock_profile_querier

            # Mock httpx responses
            mock_client = AsyncMock()

            # Mock generate-link response
            mock_link_resp = MagicMock()
            mock_link_resp.json.return_value = {
                "action_link": "https://test.supabase.co/auth/v1/verify?token_hash=abc123&type=magiclink"
            }
            mock_link_resp.raise_for_status = MagicMock()

            # Mock verify response
            mock_verify_resp = MagicMock()
            mock_verify_resp.json.return_value = {
                "access_token": "eyJ.test.jwt",
                "refresh_token": "refresh_abc",
                "expires_in": 3600,
                "expires_at": 1700000000,
            }
            mock_verify_resp.raise_for_status = MagicMock()

            mock_client.post = AsyncMock(side_effect=[mock_link_resp, mock_verify_resp])
            mock_http_class.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_http_class.return_value.__aexit__ = AsyncMock(return_value=False)

            service = AuthService(mock_conn)
            # Override the profile querier
            service.profile_querier = mock_profile_querier

            result = await service._create_supabase_session(UUID(test_user_id))

            assert result["access_token"] == "eyJ.test.jwt"
            assert result["refresh_token"] == "refresh_abc"
            assert result["expires_in"] == 3600
```

**Step 6: Run tests**

Run: `cd /Users/nirnejak/Code/superserve/platform && uv run pytest api/tests/test_auth.py -v`
Expected: All tests PASS.

---

### Task 7: Update frontend API key display

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/platform/app/src/app/(dashboard)/api-keys/page.tsx:190,211`

**Step 1: Update display prefix**

In `/Users/nirnejak/Code/superserve/platform/app/src/app/(dashboard)/api-keys/page.tsx:190`, change:

```tsx
    return `superserve_${hash}...****`;
```

**Step 2: Update description text**

In `/Users/nirnejak/Code/superserve/platform/app/src/app/(dashboard)/api-keys/page.tsx:211`, change:

```tsx
            Manage your Superserve API keys for authentication
```

**Step 3: Update the duplicate keys page**

In `/Users/nirnejak/Code/superserve/platform/app/src/app/keys/page.tsx:207`, change:

```tsx
              Manage your Superserve API keys for authentication
```

---

### Task 8: Add token refresh to CLI auth module

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/superserve/packages/cli/src/config/auth.ts`
- Modify: `/Users/nirnejak/Code/superserve/superserve/packages/cli/src/config/constants.ts`

**Step 1: Add Supabase URL constant**

In `/Users/nirnejak/Code/superserve/superserve/packages/cli/src/config/constants.ts`, add after the `DASHBOARD_URL` line (line 8):

```typescript
export const SUPABASE_URL =
  process.env.SUPERSERVE_SUPABASE_URL ?? "https://your-project.supabase.co"
```

Note: The actual Supabase URL should be provided via environment or fetched from the platform config endpoint. For now, add a placeholder that the team can configure.

**Step 2: Add `isTokenExpired()` and `refreshToken()` to auth.ts**

In `/Users/nirnejak/Code/superserve/superserve/packages/cli/src/config/auth.ts`, add imports and new functions:

```typescript
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import type { Credentials } from "../api/types"
import { AUTH_FILE, SUPABASE_URL } from "./constants"

export function saveCredentials(creds: Credentials): void {
  const dir = dirname(AUTH_FILE)
  mkdirSync(dir, { recursive: true })
  const tmp = `${AUTH_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 })
  renameSync(tmp, AUTH_FILE)
}

export function getCredentials(): Credentials | null {
  if (!existsSync(AUTH_FILE)) return null
  try {
    const text = readFileSync(AUTH_FILE, "utf-8")
    const data = JSON.parse(text)
    if (!data.token || typeof data.token !== "string") {
      try {
        unlinkSync(AUTH_FILE)
      } catch {}
      return null
    }
    return data as Credentials
  } catch {
    try {
      unlinkSync(AUTH_FILE)
    } catch {}
    return null
  }
}

export function clearCredentials(): void {
  if (existsSync(AUTH_FILE)) {
    unlinkSync(AUTH_FILE)
  }
}

export function isAuthenticated(): boolean {
  return getCredentials() !== null
}

export function isTokenExpired(creds: Credentials): boolean {
  if (!creds.expires_at) return false
  const expiresAt = new Date(creds.expires_at).getTime()
  const bufferMs = 30_000 // 30 second buffer
  return Date.now() >= expiresAt - bufferMs
}

export async function refreshToken(creds: Credentials): Promise<Credentials | null> {
  if (!creds.refresh_token) return null

  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_URL.includes("supabase") ? "" : "" },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    })

    if (!resp.ok) return null

    const data = await resp.json() as {
      access_token: string
      refresh_token: string
      expires_in: number
      expires_at: number
    }

    const newCreds: Credentials = {
      token: data.access_token,
      token_type: "Bearer",
      expires_at: new Date(data.expires_at * 1000).toISOString(),
      refresh_token: data.refresh_token,
    }

    saveCredentials(newCreds)
    return newCreds
  } catch {
    return null
  }
}

export async function getValidCredentials(): Promise<Credentials | null> {
  const creds = getCredentials()
  if (!creds) return null

  if (isTokenExpired(creds)) {
    return await refreshToken(creds)
  }

  return creds
}
```

---

### Task 9: Update CLI client to use auto-refreshing credentials

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/superserve/packages/cli/src/api/client.ts:1,30-48`

**Step 1: Update import**

In `/Users/nirnejak/Code/superserve/superserve/packages/cli/src/api/client.ts:1`, change:

```typescript
import { getValidCredentials } from "../config/auth"
```

**Step 2: Update `getHeaders()` to use auto-refreshing credentials**

Replace the `getHeaders` function (lines 30-49):

```typescript
  async function getHeaders(authenticated = true): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    }
    if (authenticated) {
      if (!cachedToken) {
        const creds = await getValidCredentials()
        if (!creds) {
          throw new PlatformAPIError(
            401,
            "Not authenticated. Run `superserve login` first.",
          )
        }
        cachedToken = creds.token
      }
      headers.Authorization = `Bearer ${cachedToken}`
    }
    return headers
  }
```

**Step 3: Update all callers of `getHeaders` to await it**

In the `request` function (line 76), change:

```typescript
    const headers = await getHeaders(authenticated)
```

---

### Task 10: Update CLI login command

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/superserve/packages/cli/src/commands/login.ts:33-48,95-129`

**Step 1: Add deprecation warning for `--api-key` flag**

Replace the `loginWithApiKey` function (lines 33-48):

```typescript
async function loginWithApiKey(
  client: SuperserveClient,
  apiKey: string,
): Promise<void> {
  log.warn("Warning: --api-key login is deprecated. API keys are for SDK/REST use.")
  log.warn("Use `superserve login` (device flow) for CLI authentication.\n")

  const creds: Credentials = { token: apiKey }
  saveCredentials(creds)

  if (!(await client.validateToken())) {
    clearCredentials()
    log.error("Invalid API key")
    process.exitCode = 1
    return
  }

  log.success("Authenticated successfully with API key.")
}
```

**Step 2: Verify the device flow already correctly saves expires_at and refresh_token**

Check `/Users/nirnejak/Code/superserve/superserve/packages/cli/src/api/client.ts:220-224` — the `pollDeviceToken` function already returns:

```typescript
    return {
      token,
      expires_at: data.expires_at,
      refresh_token: data.refresh_token,
    }
```

This is correct — the new Supabase response will include `expires_at` and `refresh_token`, and the CLI will save them. No change needed here.

---

### Task 11: Update auth_service.py config comment

**Files:**
- Modify: `/Users/nirnejak/Code/superserve/platform/api/app/config.py:39-41`

**Step 1: Update auth comment**

In `/Users/nirnejak/Code/superserve/platform/api/app/config.py:39-41`, change:

```python
    # Auth
    # JWT verification uses Supabase JWKS (ES256). CLI and dashboard use Supabase tokens.
    device_code_expiry_minutes: int = 15
    # Supabase JWT secret for token verification fallback
    supabase_jwt_secret: str = ""
```

---

### Task 12: Run all platform tests

**Step 1: Run the full test suite**

Run: `cd /Users/nirnejak/Code/superserve/platform && uv run pytest api/tests/ -v`
Expected: All tests PASS.

**Step 2: Run linter**

Run: `cd /Users/nirnejak/Code/superserve/platform && uv run ruff check api/ --fix && uv run ruff format api/`
Expected: Clean (or auto-fixed).

---

### Task 13: Run CLI typecheck and lint

**Step 1: Typecheck the CLI**

Run: `cd /Users/nirnejak/Code/superserve/superserve && bunx turbo run typecheck --filter=@superserve/cli`
Expected: PASS.

**Step 2: Lint**

Run: `cd /Users/nirnejak/Code/superserve/superserve && bun run lint`
Expected: PASS (or fixable issues).

---

### Summary of all files changed

**Platform API (`/Users/nirnejak/Code/superserve/platform/`):**
1. `api/app/services/auth_service.py` — Replace `_create_api_key` with `_create_supabase_session`, update imports, docstring
2. `api/app/middleware/auth.py` — Rename header, update prefix detection, update docstring
3. `api/app/routes/api_keys.py` — Update prefix in `generate_api_key()`
4. `api/app/schemas/auth.py` — Update client_id, docstrings
5. `api/app/config.py` — Add `supabase_jwt_secret`, update comment
6. `api/main.py` — Update CORS header
7. `api/scripts/mint_jwt_token.py` — Update issuer
8. `api/tests/conftest.py` — Update test API key prefix, email
9. `api/tests/test_auth.py` — Update prefix assertions, replace API key creation test

**Platform Frontend (`/Users/nirnejak/Code/superserve/platform/`):**
10. `app/src/app/(dashboard)/api-keys/page.tsx` — Update display prefix, description
11. `app/src/app/keys/page.tsx` — Update description

**CLI (`/Users/nirnejak/Code/superserve/superserve/`):**
12. `packages/cli/src/config/constants.ts` — Add `SUPABASE_URL`
13. `packages/cli/src/config/auth.ts` — Add `isTokenExpired`, `refreshToken`, `getValidCredentials`
14. `packages/cli/src/api/client.ts` — Use `getValidCredentials`, make `getHeaders` async
15. `packages/cli/src/commands/login.ts` — Add deprecation warning for `--api-key`
