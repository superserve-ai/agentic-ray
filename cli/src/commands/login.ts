import { exec } from "node:child_process"
import { platform } from "node:os"
import { Command } from "commander"
import { track } from "../analytics"
import type { SuperserveClient } from "../api/client"
import { createClient } from "../api/client"
import { PlatformAPIError } from "../api/errors"
import type { Credentials } from "../api/types"
import {
  clearCredentials,
  getCredentials,
  saveCredentials,
} from "../config/auth"
import { DEVICE_POLL_INTERVAL } from "../config/constants"
import { withErrorHandler } from "../errors"
import { commandBox } from "../utils/command-box"
import { log } from "../utils/logger"

function openBrowser(url: string): void {
  const cmd =
    platform() === "darwin"
      ? "open"
      : platform() === "win32"
        ? "start"
        : "xdg-open"
  exec(`${cmd} "${url}"`)
}

async function loginWithApiKey(
  client: SuperserveClient,
  apiKey: string,
): Promise<void> {
  const creds: Credentials = { token: apiKey }
  saveCredentials(creds)

  if (!(await client.validateToken())) {
    clearCredentials()
    log.error("Invalid API key")
    process.exit(1)
  }

  log.success("Authenticated successfully with API key.")
}

async function loginWithDeviceFlow(client: SuperserveClient): Promise<void> {
  const device = await client.getDeviceCode()

  console.log(`\nTo authenticate, visit: ${device.verification_uri}`)
  console.log(`Enter code: \x1b[1m${device.user_code}\x1b[0m\n`)

  try {
    openBrowser(device.verification_uri_complete)
    console.log("Browser opened automatically.")
  } catch {
    console.log("Please open the URL above in your browser.")
  }

  console.log("\nWaiting for authentication...")

  const start = Date.now()
  let pollInterval = Math.max(device.interval * 1000, DEVICE_POLL_INTERVAL)

  while (Date.now() - start < device.expires_in * 1000) {
    try {
      const creds = await client.pollDeviceToken(device.device_code)
      saveCredentials(creds)
      log.success("Authenticated successfully!")
      return
    } catch (e) {
      if (e instanceof PlatformAPIError) {
        const oauthError = e.details.oauth_error as string | undefined
        if (oauthError === "authorization_pending") {
          await Bun.sleep(pollInterval)
        } else if (oauthError === "slow_down") {
          pollInterval += 1000
          await Bun.sleep(pollInterval)
        } else {
          throw e
        }
      } else {
        throw e
      }
    }
  }

  log.error("Authentication timed out")
  process.exit(1)
}

export const login = new Command("login")
  .description("Authenticate with Superserve Cloud")
  .option("--api-key <key>", "API key for authentication")
  .action(
    withErrorHandler(async (options: { apiKey?: string }) => {
      const client = createClient()

      const existing = getCredentials()
      if (existing && !options.apiKey) {
        if (await client.validateToken()) {
          console.log("Already logged in. To sign out, run:")
          console.log(commandBox("superserve logout"))
          return
        }
      }

      if (options.apiKey) {
        await loginWithApiKey(client, options.apiKey)
      } else {
        await loginWithDeviceFlow(client)
      }

      track("cli_login")
    }),
  )
