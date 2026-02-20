import { Command } from "commander"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"
import { confirm } from "../../utils/prompt"

export const deleteSecret = new Command("delete")
  .description("Delete a secret from an agent")
  .argument("<agent>", "Agent name or ID")
  .argument("<key>", "Secret key to delete")
  .option("-y, --yes", "Skip confirmation")
  .action(
    withErrorHandler(
      async (agentName: string, key: string, options: { yes?: boolean }) => {
        if (!options.yes) {
          const confirmed = await confirm(
            `Delete secret '${key}' from agent '${agentName}'?`,
          )
          if (!confirmed) {
            console.log("Cancelled")
            return
          }
        }

        const client = createClient()
        const keys = await client.deleteAgentSecret(agentName, key)

        log.success(`Deleted secret '${key}' from agent '${agentName}'`)
        if (keys.length > 0) {
          console.log(`Remaining secrets: ${keys.join(", ")}`)
        }
      },
    ),
  )
