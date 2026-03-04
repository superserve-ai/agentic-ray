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

export async function refreshToken(
  creds: Credentials,
): Promise<Credentials | null> {
  if (!creds.refresh_token) return null

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_URL.split("//")[1]?.split(".")[0] ?? "",
        },
        body: JSON.stringify({ refresh_token: creds.refresh_token }),
      },
    )

    if (!resp.ok) return null

    const data = (await resp.json()) as {
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
