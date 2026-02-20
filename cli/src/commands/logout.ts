import { Command } from "commander"
import { track } from "../analytics"
import { clearCredentials, getCredentials } from "../config/auth"
import { log } from "../utils/logger"

export const logout = new Command("logout")
  .description("Log out from Superserve Cloud")
  .action(async () => {
    if (!getCredentials()) {
      console.log("Not logged in.")
      return
    }

    clearCredentials()
    log.success("Logged out successfully.")
    track("cli_logout")
  })
