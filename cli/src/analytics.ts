import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { SUPERSERVE_CONFIG_DIR } from "./config/constants"

const POSTHOG_PUBLIC_API_KEY = "phc_gjpDKKKQJAnkxkqLrPGrAhoariKsaHNuTpI5rVhkYre"
const POSTHOG_HOST = "https://us.i.posthog.com"

const ANONYMOUS_ID_FILE = join(SUPERSERVE_CONFIG_DIR, "anonymous_id")
const ANALYTICS_DISABLED_FILE = join(
  SUPERSERVE_CONFIG_DIR,
  ".analytics_disabled",
)

function isDisabled(): boolean {
  if (existsSync(ANALYTICS_DISABLED_FILE)) return true
  return Boolean(
    process.env.SUPERSERVE_DO_NOT_TRACK || process.env.DO_NOT_TRACK,
  )
}

function getAnonymousId(): string {
  mkdirSync(SUPERSERVE_CONFIG_DIR, { recursive: true })

  if (existsSync(ANONYMOUS_ID_FILE)) {
    return readFileSync(ANONYMOUS_ID_FILE, "utf-8").trim()
  }

  const anonymousId = randomUUID()
  writeFileSync(ANONYMOUS_ID_FILE, anonymousId)
  return anonymousId
}

// Lazy PostHog singleton
type PostHogClient = {
  capture: (opts: Record<string, unknown>) => void
  shutdown: () => Promise<void>
}
let posthogInstance: PostHogClient | null = null

async function getPostHog(): Promise<PostHogClient> {
  if (!posthogInstance) {
    const { PostHog } = await import("posthog-node")
    posthogInstance = new PostHog(POSTHOG_PUBLIC_API_KEY, {
      host: POSTHOG_HOST,
    })
  }
  return posthogInstance
}

export async function track(
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (isDisabled()) return

  try {
    const posthog = await getPostHog()
    posthog.capture({
      distinctId: getAnonymousId(),
      event,
      properties: properties ?? {},
    })
  } catch {
    // Fail silently — analytics should never break the CLI
  }
}

export async function flushAnalytics(): Promise<void> {
  if (!posthogInstance) return
  try {
    await posthogInstance.shutdown()
  } catch {
    // Fail silently
  }
}

// Ensure analytics flush even on early process.exit() calls
let exitHookRegistered = false
export function registerExitHook(): void {
  if (exitHookRegistered) return
  exitHookRegistered = true
  process.on("beforeExit", async () => {
    await flushAnalytics()
  })
}
