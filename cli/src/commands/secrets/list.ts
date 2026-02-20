import pc from "picocolors"

const { bold } = pc

import { Command } from "commander"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { commandBox } from "../../utils/command-box"
import { createTable } from "../../utils/table"

export const listSecrets = new Command("list")
  .description("List secret keys for an agent")
  .argument("<agent>", "Agent name or ID")
  .action(
    withErrorHandler(async (agentName: string) => {
      const client = createClient()
      const keys = await client.getAgentSecrets(agentName)

      if (keys.length === 0) {
        console.log(`No secrets configured for agent '${agentName}'`)
        console.log("Set secrets with:")
        console.log(commandBox("superserve secrets set my-agent KEY=VALUE"))
        return
      }

      const table = createTable([bold("Key")])

      for (const key of keys) {
        table.push([key])
      }

      console.log(`Secrets for agent '${agentName}':\n`)
      console.log(table.toString())
    }),
  )
