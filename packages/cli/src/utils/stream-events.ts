import type { RunEvent } from "../api/types"
import { formatDuration } from "./format"
import { log } from "./logger"
import { sanitizeTerminalOutput } from "./sanitize"
import type { Spinner } from "./spinner"

/**
 * Writes to stdout, flushing line-by-line when stdout is a pipe (non-TTY).
 *
 * When stdout is a pipe (e.g. in CI), the OS uses block buffering which means
 * small writes don't appear until the buffer fills (~64KB) or the process exits.
 * This helper buffers content locally and flushes complete lines via console.log()
 * which is guaranteed to flush. In TTY mode, it writes directly for real-time
 * character-by-character streaming.
 */
function createLineWriter() {
  const isTTY = process.stdout.isTTY
  let lineBuffer = ""

  return {
    write(text: string): void {
      if (isTTY) {
        process.stdout.write(text)
        return
      }

      lineBuffer += text
      // Flush all complete lines
      let newlineIdx = lineBuffer.indexOf("\n")
      while (newlineIdx !== -1) {
        const line = lineBuffer.slice(0, newlineIdx)
        console.log(line)
        lineBuffer = lineBuffer.slice(newlineIdx + 1)
        newlineIdx = lineBuffer.indexOf("\n")
      }
    },

    /** Flush any remaining partial line */
    flush(): void {
      if (!isTTY && lineBuffer) {
        console.log(lineBuffer)
        lineBuffer = ""
      }
    },

    get hasContent(): boolean {
      if (isTTY) return false
      return lineBuffer.length > 0
    },
  }
}

export async function streamEvents(
  events: AsyncIterableIterator<RunEvent>,
  spinner: Spinner | null,
): Promise<number> {
  let agentPrefixShown = false
  let contentOnCurrentLine = false
  const writer = createLineWriter()

  for await (const event of events) {
    switch (event.type) {
      case "status":
      case "run.started":
      case "heartbeat":
        break
      case "message.delta": {
        spinner?.stop()
        if (!agentPrefixShown) {
          writer.write("Agent> ")
          agentPrefixShown = true
        }
        const content = sanitizeTerminalOutput(event.data.content ?? "")
        writer.write(content)
        contentOnCurrentLine = !content.endsWith("\n")
        break
      }
      case "tool.start": {
        spinner?.stop()
        writer.flush()
        if (contentOnCurrentLine) {
          writer.write("\n")
          contentOnCurrentLine = false
        }
        const tool = event.data.tool ?? "unknown"
        const raw = event.data.input ?? {}
        const toolInput = typeof raw === "string" ? raw : JSON.stringify(raw)
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
        writer.flush()
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
        writer.flush()
        const error = event.data.error
        const message = error?.message
          ? sanitizeTerminalOutput(error.message)
          : null
        if (message) {
          log.error(message)
        } else {
          log.error(
            "Something went wrong while running the agent. Please try again later.",
          )
        }
        return 1
      }
      case "run.cancelled": {
        spinner?.stop()
        writer.flush()
        console.error("\nRun was cancelled.")
        return 130
      }
    }
  }

  writer.flush()
  return 1
}

export async function streamEventsJson(
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

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
