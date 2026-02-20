import type { RunEvent } from "./types"

const KNOWN_EVENT_TYPES = new Set([
  "message.delta",
  "tool.start",
  "tool.end",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "status",
  "run.started",
  "heartbeat",
])

export async function* parseSSEStream(
  response: Response,
): AsyncIterableIterator<RunEvent> {
  if (!response.body) {
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ""
  let currentEventType: string | null = null
  let dataLines: string[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    while (buffer.includes("\n")) {
      const newlineIdx = buffer.indexOf("\n")
      const line = buffer.slice(0, newlineIdx).replace(/\r$/, "")
      buffer = buffer.slice(newlineIdx + 1)

      if (!line) {
        // Empty line = end of SSE event
        if (currentEventType && dataLines.length > 0) {
          const event = parseEvent(currentEventType, dataLines)
          if (event) yield event
        }
        currentEventType = null
        dataLines = []
        continue
      }

      if (line.startsWith("event: ")) {
        currentEventType = line.slice(7)
      } else if (line.startsWith("data: ")) {
        dataLines.push(line.slice(6))
      }
    }
  }

  // Handle any remaining buffered event
  if (currentEventType && dataLines.length > 0) {
    const event = parseEvent(currentEventType, dataLines)
    if (event) yield event
  }
}

function parseEvent(eventType: string, dataLines: string[]): RunEvent | null {
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    return null
  }

  const fullData = dataLines.join("\n")
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(fullData)
  } catch {
    parsed = { raw: fullData }
  }

  return { type: eventType, data: parsed } as RunEvent
}
