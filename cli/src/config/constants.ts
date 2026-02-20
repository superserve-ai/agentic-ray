import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../package.json"), "utf-8"),
)

// PRODUCTION
// export const PLATFORM_API_URL =
//   process.env.SUPERSERVE_API_URL ?? "https://api.superserve.ai"
// export const DASHBOARD_URL =
//   process.env.SUPERSERVE_DASHBOARD_URL ?? "https://console.superserve.ai"

// STAGING
export const PLATFORM_API_URL =
  process.env.SUPERSERVE_API_URL ?? "https://api-staging.superserve.ai"

export const DASHBOARD_URL =
  process.env.SUPERSERVE_DASHBOARD_URL ??
  "https://console-staging.superserve.ai"

export const SUPERSERVE_CONFIG_DIR = join(homedir(), ".superserve")

export const AUTH_FILE = join(SUPERSERVE_CONFIG_DIR, "auth.json")

export const USER_AGENT = `superserve-cli/${pkg.version}`

export const CLI_VERSION: string = pkg.version

export const DEFAULT_TIMEOUT = 30_000 // 30 seconds in ms

export const DEVICE_POLL_INTERVAL = 5_000 // 5 seconds in ms

export const SUPERSERVE_YAML = "superserve.yaml"
