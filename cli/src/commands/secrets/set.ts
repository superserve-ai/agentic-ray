import { Command } from "commander"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"

export const setSecrets = new Command("set")
  .description("Set secrets for an agent")
  .argument("<agent>", "Agent name or ID")
  .argument("<key-values...>", "KEY=VALUE pairs")
  .action(
    withErrorHandler(async (agentName: string, keyValues: string[]) => {
      const envVars: Record<string, string> = {}

      for (const kv of keyValues) {
        if (!kv.includes("=")) {
          throw new Error(`Invalid format '${kv}'. Use KEY=VALUE`)
        }
        const eqIdx = kv.indexOf("=")
        const key = kv.slice(0, eqIdx)
        const value = kv.slice(eqIdx + 1)
        if (!key) {
          throw new Error(`Empty key in '${kv}'`)
        }
        envVars[key] = value
      }

      const client = createClient()
      const keys = await client.setAgentSecrets(agentName, envVars)

      log.success(
        `Set ${Object.keys(envVars).length} secret(s) for agent '${agentName}'`,
      )
      if (keys.length > 0) {
        console.log(`Current secrets: ${keys.join(", ")}`)
      }
    }),
  )
