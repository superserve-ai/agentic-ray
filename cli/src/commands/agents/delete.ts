import { Command } from "commander"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"
import { confirm } from "../../utils/prompt"

export const deleteAgent = new Command("delete")
  .description("Delete a hosted agent")
  .argument("<name>", "Agent name or ID")
  .option("-y, --yes", "Skip confirmation")
  .action(
    withErrorHandler(async (name: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm(`Delete agent '${name}'?`)
        if (!confirmed) {
          console.log("Cancelled")
          return
        }
      }

      const client = createClient()
      await client.deleteAgent(name)
      log.success(`Deleted agent '${name}'`)
    }),
  )
