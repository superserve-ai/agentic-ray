import pc from "picocolors"

const { bold, dim } = pc

import { Command } from "commander"
import { createClient } from "../../api/client"
import type { AgentResponse } from "../../api/types"
import { withErrorHandler } from "../../errors"
import { commandBox } from "../../utils/command-box"
import { formatTimestamp } from "../../utils/format"
import { sanitizeTerminalOutput } from "../../utils/sanitize"
import { createTable } from "../../utils/table"
import { coloredStatus } from "./status"

// Maps user-facing status labels to deps_status values
const STATUS_FILTER_MAP: Record<string, string[]> = {
  ready: ["none", "ready"],
  deploying: ["installing"],
  failed: ["failed"],
  // Also allow raw deps_status values
  none: ["none"],
  installing: ["installing"],
}

export const listAgents = new Command("list")
  .description("List all hosted agents")
  .option("--status <status>", "Filter by agent status")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(async (options: { status?: string; json?: boolean }) => {
      const client = createClient()
      let agentList: AgentResponse[] = await client.listAgents()

      if (options.status) {
        const filterKey = options.status.toLowerCase()
        const matchValues = STATUS_FILTER_MAP[filterKey]
        if (matchValues) {
          agentList = agentList.filter((a) =>
            matchValues.includes(a.deps_status),
          )
        } else {
          // Fall back to exact match on deps_status
          agentList = agentList.filter(
            (a) => a.deps_status.toLowerCase() === filterKey,
          )
        }
      }

      if (options.json) {
        console.log(JSON.stringify(agentList, null, 2))
        return
      }

      if (agentList.length === 0) {
        console.log("No agents found. Deploy one with:\n")
        console.log(commandBox("superserve deploy"))
        return
      }

      const table = createTable([
        bold("Name"),
        bold("ID"),
        bold("Status"),
        bold("Created"),
      ])

      for (const agent of agentList) {
        table.push([
          sanitizeTerminalOutput(agent.name),
          dim(agent.id),
          coloredStatus(agent.deps_status),
          dim(formatTimestamp(agent.created_at, true)),
        ])
      }

      console.log(table.toString())
    }),
  )
