import pc from "picocolors"

const { bold, dim } = pc

import { Command } from "commander"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { formatTimestamp } from "../../utils/format"
import { sanitizeTerminalOutput } from "../../utils/sanitize"
import { createTable } from "../../utils/table"
import { coloredSessionStatus } from "./status"

export const getSession = new Command("get")
  .description("Get session details")
  .argument("<session-id>", "Session ID or short prefix")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(async (sessionId: string, options: { json?: boolean }) => {
      const client = createClient()
      const session = await client.getSession(sessionId)

      if (options.json) {
        console.log(JSON.stringify(session))
        return
      }

      const agentDisplay =
        session.agent_name && session.agent_id
          ? `${sanitizeTerminalOutput(session.agent_name)} (${session.agent_id})`
          : sanitizeTerminalOutput(
              session.agent_name ?? session.agent_id ?? "?",
            )

      const table = createTable([bold("Field"), bold("Value")])

      table.push(
        [bold("ID"), dim(session.id)],
        [bold("Agent"), agentDisplay],
        [bold("Status"), coloredSessionStatus(session.status ?? "?")],
        [bold("Messages"), String(session.message_count ?? 0)],
        [bold("Created"), dim(formatTimestamp(session.created_at ?? ""))],
      )

      if (session.title) {
        table.push([bold("Title"), sanitizeTerminalOutput(session.title)])
      }

      console.log(table.toString())
    }),
  )
