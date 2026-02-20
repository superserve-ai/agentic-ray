import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import type { Credentials } from "../api/types"
import { AUTH_FILE } from "./constants"

export function saveCredentials(creds: Credentials): void {
  const dir = dirname(AUTH_FILE)
  mkdirSync(dir, { recursive: true })
  writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2))
  chmodSync(AUTH_FILE, 0o600)
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
