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

describe("parseSSEStream", () => {
  test("parses single event", async () => {
    const response = createMockResponse([
      'event: message.delta\ndata: {"content":"Hello"}\n\n',
    ])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("message.delta")
    if (events[0].type === "message.delta") {
      expect(events[0].data.content).toBe("Hello")
    }
  })

  test("parses multiple events", async () => {
    const response = createMockResponse([
      'event: message.delta\ndata: {"content":"Hi"}\n\nevent: run.completed\ndata: {"duration_ms":100}\n\n',
    ])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(2)
    expect(events[0].type).toBe("message.delta")
    expect(events[1].type).toBe("run.completed")
  })

  test("handles chunked data", async () => {
    const response = createMockResponse([
      "event: message.del",
      'ta\ndata: {"content":"He',
      'llo"}\n\n',
    ])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    if (events[0].type === "message.delta") {
      expect(events[0].data.content).toBe("Hello")
    }
  })

  test("handles multi-line data", async () => {
    const response = createMockResponse([
      'event: message.delta\ndata: {"content":\ndata: "Hello"}\n\n',
    ])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    // Multi-line data gets joined with newlines, may not be valid JSON
    expect(events[0]).toBeTruthy()
  })

  test("handles empty stream", async () => {
    const response = createMockResponse([])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(0)
  })

  test("handles invalid JSON gracefully", async () => {
    const response = createMockResponse(["event: status\ndata: not-json\n\n"])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    // status event with passthrough data should still parse
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("status")
  })

  test("skips unknown event types", async () => {
    const originalError = console.error
    const errors: string[] = []
    console.error = (...args: unknown[]) => {
      errors.push(String(args[0]))
    }

    try {
      const response = createMockResponse([
        'event: message.delta\ndata: {"content":"Hi"}\n\n',
        'event: unknown.future.event\ndata: {"foo":"bar"}\n\n',
        'event: run.completed\ndata: {"duration_ms":100}\n\n',
      ])

      const events: RunEvent[] = []
      for await (const event of parseSSEStream(response)) {
        events.push(event)
      }

      // Unknown event should be skipped, not yielded
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe("message.delta")
      expect(events[1].type).toBe("run.completed")

      // Should silently skip without logging
      expect(errors).toHaveLength(0)
    } finally {
      console.error = originalError
    }
  })

  test("yields typed RunEvent discriminated union", async () => {
    const response = createMockResponse([
      'event: tool.start\ndata: {"tool":"web_search","input":{"q":"test"}}\n\n',
      'event: tool.end\ndata: {"duration_ms":150}\n\n',
      'event: run.completed\ndata: {"duration_ms":500}\n\n',
    ])

    const events: RunEvent[] = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(3)

    // Type narrowing should work
    const toolStart = events[0]
    if (toolStart.type === "tool.start") {
      expect(toolStart.data.tool).toBe("web_search")
    }

    const toolEnd = events[1]
    if (toolEnd.type === "tool.end") {
      expect(toolEnd.data.duration_ms).toBe(150)
    }

    const completed = events[2]
    if (completed.type === "run.completed") {
      expect(completed.data.duration_ms).toBe(500)
    }
  })
})
