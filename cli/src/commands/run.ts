import { Command } from "commander"

import { createClient } from "../api/client"
import type { RunEvent } from "../api/types"
import { withErrorHandler } from "../errors"
import { commandBox } from "../utils/command-box"
import { formatDuration } from "../utils/format"
import { log } from "../utils/logger"
import { promptUser } from "../utils/prompt"
import { sanitizeTerminalOutput } from "../utils/sanitize"
import { createSpinner, type Spinner } from "../utils/spinner"

async function streamEvents(
  events: AsyncIterableIterator<RunEvent>,
  spinner: Spinner | null,
): Promise<number> {
  for await (const event of events) {
    switch (event.type) {
      case "status":
      case "run.started":
      case "heartbeat":
        break
      case "message.delta": {
        spinner?.stop()
        process.stdout.write(sanitizeTerminalOutput(event.data.content ?? ""))
        break
      }
      case "tool.start": {
        spinner?.stop()
        const tool = event.data.tool ?? "unknown"
        const toolInput = String(event.data.input ?? {})
        const inputStr = sanitizeTerminalOutput(toolInput)
        const inputPreview =
          inputStr.length > 50 ? `${inputStr.slice(0, 50)}...` : inputStr
        process.stderr.write(`\n[${tool}] ${inputPreview}`)
        break
      }
      case "tool.end": {
        process.stderr.write(
          ` (${formatDuration(event.data.duration_ms ?? 0)})\n`,
        )
        spinner?.start()
        break
      }
      case "run.completed": {
        spinner?.stop()
        const durationMs = event.data.duration_ms ?? 0
        console.log()
        log.success(`Completed in ${formatDuration(durationMs)}`)
        if (event.data.max_turns_reached) {
          const msg = sanitizeTerminalOutput(
            event.data.max_turns_message ?? "Max turns reached.",
          )
          console.error(`\nWarning: ${msg}`)
        }
        return 0
      }
      case "run.failed": {
        spinner?.stop()
        log.error(
          "Something went wrong while running the agent. Please try again later.",
        )
        return 1
      }
      case "run.cancelled": {
        spinner?.stop()
        console.error("\nRun was cancelled.")
        return 130
      }
    }
  }

  return 1
}

async function streamEventsJson(
  eventIter: AsyncIterableIterator<RunEvent>,
): Promise<number> {
  for await (const event of eventIter) {
    console.log(JSON.stringify({ type: event.type, data: event.data }))
    if (event.type === "run.completed") return 0
    if (event.type === "run.failed") return 1
    if (event.type === "run.cancelled") return 130
  }
  return 1
}

export const run = new Command("run")
  .description("Run a hosted agent interactively")
  .argument("<agent>", "Agent name or ID")
  .argument("[prompt]", "Initial prompt")
  .option("--single", "Exit after a single response (no interactive loop)")
  .option("--json", "Output raw JSON events")
  .action(
    withErrorHandler(
      async (
        agent: string,
        prompt: string | undefined,
        options: { single?: boolean; json?: boolean },
      ) => {
        const client = createClient()
        let spinner: Spinner | null = null

        // Handle Ctrl+C
        process.on("SIGINT", () => {
          spinner?.stop()
          console.error("\nCancelled.")
          process.exit(130)
        })

        // If no prompt, ask for one
        if (!prompt) {
          const p = await promptUser()
          if (!p || !p.trim()) return
          prompt = p
        }

        const interactive =
          !options.single && !options.json && process.stdin.isTTY
        const useSpinner = !options.json && process.stderr.isTTY

        // Pre-flight: check required secrets
        try {
          const agentInfo = await client.getAgent(agent)
          if (agentInfo.required_secrets.length > 0) {
            const missing = agentInfo.required_secrets.filter(
              (s) => !agentInfo.environment_keys.includes(s),
            )
            if (missing.length > 0) {
              log.error(`Missing required secret(s): ${missing.join(", ")}`)
              console.error("Set them with:")
              console.error(
                commandBox(
                  `superserve secrets set ${agentInfo.name} ${missing.map((k) => `${k}=...`).join(" ")}`,
                ),
              )
              process.exit(1)
            }
          }
        } catch {
          // Let session creation handle auth/404 errors
        }

        try {
          if (useSpinner) {
            spinner = createSpinner({ showElapsed: true })
            spinner.start()
          }

          const sessionData = await client.createSession(agent)
          const sessionId = sessionData.id

          // Stream events
          let exitCode: number
          if (options.json) {
            exitCode = await streamEventsJson(
              client.streamSessionMessage(sessionId, prompt),
            )
          } else {
            exitCode = await streamEvents(
              client.streamSessionMessage(sessionId, prompt),
              spinner,
            )
          }
          if (exitCode) process.exit(exitCode)

          if (!interactive) return

          // Interactive loop
          while (true) {
            const nextPrompt = await promptUser()
            if (
              !nextPrompt ||
              !nextPrompt.trim() ||
              nextPrompt.trim().toLowerCase() === "exit"
            ) {
              break
            }

            spinner?.start()

            exitCode = await streamEvents(
              client.streamSessionMessage(sessionId, nextPrompt),
              spinner,
            )
            if (exitCode) process.exit(exitCode)
          }
        } finally {
          spinner?.stop()
        }
      },
    ),
  )
