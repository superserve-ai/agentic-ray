import { homedir } from "node:os"
import { join } from "node:path"
import pkg from "../../package.json"

export const PLATFORM_API_URL =
  process.env.SUPERSERVE_API_URL ?? "https://api.superserve.ai"
export const DASHBOARD_URL =
  process.env.SUPERSERVE_DASHBOARD_URL ?? "https://console.superserve.ai"
export const SUPABASE_URL =
  process.env.SUPERSERVE_SUPABASE_URL ?? "https://rifhalqzxgskwajjgipj.supabase.co"

export const SUPERSERVE_CONFIG_DIR = join(homedir(), ".superserve")

export const AUTH_FILE = join(SUPERSERVE_CONFIG_DIR, "auth.json")

export const CLI_VERSION: string = pkg.version

export const USER_AGENT = `superserve-cli/${CLI_VERSION}`

export const DEFAULT_TIMEOUT = 30_000 // 30 seconds in ms

export const DEVICE_POLL_INTERVAL = 5_000 // 5 seconds in ms

export const SUPERSERVE_YAML = "superserve.yaml"
