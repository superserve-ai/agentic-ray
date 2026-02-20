import pc from "picocolors"

const { bold, dim } = pc

import { Command } from "commander"
import { createClient } from "../../api/client"
import type { SessionData } from "../../api/types"
import { withErrorHandler } from "../../errors"
import { commandBox } from "../../utils/command-box"
import { formatTimestamp } from "../../utils/format"
import { sanitizeTerminalOutput } from "../../utils/sanitize"
import { createTable } from "../../utils/table"
import { coloredSessionStatus } from "./status"

export const listSessions = new Command("list")
  .description("List sessions")
  .option("--agent <name>", "Filter by agent name or ID")
  .option("--status <status>", "Filter by status")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(
      async (options: { agent?: string; status?: string; json?: boolean }) => {
        const client = createClient()
        const sessionList: SessionData[] = await client.listSessions(
          options.agent,
          options.status,
        )

        if (options.json) {
          console.log(JSON.stringify(sessionList))
          return
        }

        if (sessionList.length === 0) {
          console.log("No sessions found. Start one with:\n")
          console.log(commandBox('superserve run <agent> "your prompt"'))
          return
        }

        const table = createTable([
          bold("ID"),
          bold("Agent"),
          bold("Status"),
          bold("Msgs"),
          bold("Created"),
        ])

        for (const s of sessionList) {
          const sidClean = s.id.replace("ses_", "").replace(/-/g, "")
          const sidShort = sidClean.slice(0, 12)
          const agentDisplay = sanitizeTerminalOutput(
            s.agent_name ?? s.agent_id ?? "?",
          )

          table.push([
            sidShort,
            agentDisplay,
            coloredSessionStatus(s.status ?? "?"),
            String(s.message_count ?? 0),
            dim(formatTimestamp(s.created_at, true)),
          ])
        }

        console.log(table.toString())
      },
    ),
  )
