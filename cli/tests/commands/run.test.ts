import { describe, expect, test } from "bun:test"
import { parseSSEStream } from "../../src/api/streaming"
import type { RunEvent } from "../../src/api/types"

function createMockResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let chunkIdx = 0

  const stream = new ReadableStream({
    pull(controller) {
      if (chunkIdx < chunks.length) {
        controller.enqueue(encoder.encode(chunks[chunkIdx]))
        chunkIdx++
      } else {
        controller.close()
      }
    },
  })

  return new Response(stream)
}

describe("run - stream event processing", () => {
  test("processes message.delta events", async () => {
    const response = createMockResponse([
      'event: message.delta\ndata: {"content":"Hello "}\n\n',
      'event: message.delta\ndata: {"content":"World"}\n\n',
      'event: run.completed\ndata: {"duration_ms":500}\n\n',
    ])

    let content = ""
    let completed = false

    for await (const event of parseSSEStream(response)) {
      if (event.type === "message.delta") {
        content += event.data.content ?? ""
      } else if (event.type === "run.completed") {
        completed = true
      }
    }

    expect(content).toBe("Hello World")
    expect(completed).toBe(true)
  })

  test("processes tool events", async () => {
    const response = createMockResponse([
      'event: tool.start\ndata: {"tool":"web_search","input":{"query":"test"}}\n\n',
      'event: tool.end\ndata: {"duration_ms":200}\n\n',
      'event: message.delta\ndata: {"content":"Result"}\n\n',
      'event: run.completed\ndata: {"duration_ms":500}\n\n',
    ])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(4)
    expect(events[0].type).toBe("tool.start")
    if (events[0].type === "tool.start") {
      expect(events[0].data.tool).toBe("web_search")
    }
    expect(events[1].type).toBe("tool.end")
    if (events[1].type === "tool.end") {
      expect(events[1].data.duration_ms).toBe(200)
    }
  })

  test("handles run.failed events", async () => {
    const response = createMockResponse([
      'event: run.failed\ndata: {"error":{"message":"Something went wrong"}}\n\n',
    ])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("run.failed")
    if (events[0].type === "run.failed") {
      expect(events[0].data.error?.message).toBe("Something went wrong")
    }
  })

  test("handles run.cancelled events", async () => {
    const response = createMockResponse([
      'event: message.delta\ndata: {"content":"partial"}\n\n',
      "event: run.cancelled\ndata: {}\n\n",
    ])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(2)
    expect(events[1].type).toBe("run.cancelled")
  })
})
