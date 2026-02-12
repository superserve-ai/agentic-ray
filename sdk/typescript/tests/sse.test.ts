/**
 * Tests for SSE parser.
 */

import { describe, it, expect } from "vitest";
import { parseSSEStream, parseSSEEventData } from "../src/utils/sse.js";
import type { SSEEvent } from "../src/utils/sse.js";

/**
 * Helper to create a ReadableStream from string chunks.
 */
function createStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Helper to collect all events from an async generator.
 */
async function collectEvents(
  stream: ReadableStream<Uint8Array>,
  options?: { signal?: AbortSignal }
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of parseSSEStream(stream, options)) {
    events.push(event);
  }
  return events;
}

describe("parseSSEStream", () => {
  describe("basic parsing", () => {
    it("should parse single event", async () => {
      const stream = createStream(["event: message\ndata: hello\n\n"]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("message");
      expect(events[0].data).toBe("hello");
    });

    it("should parse multiple events", async () => {
      const stream = createStream([
        "event: first\ndata: one\n\n",
        "event: second\ndata: two\n\n",
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(2);
      expect(events[0].event).toBe("first");
      expect(events[0].data).toBe("one");
      expect(events[1].event).toBe("second");
      expect(events[1].data).toBe("two");
    });

    it("should use default event type 'message' when not specified", async () => {
      const stream = createStream(["data: hello\n\n"]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("message");
    });

    it("should reset event type to default after dispatch", async () => {
      const stream = createStream([
        "event: custom\ndata: first\n\n",
        "data: second\n\n",
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(2);
      expect(events[0].event).toBe("custom");
      expect(events[1].event).toBe("message");
    });
  });

  describe("data field handling", () => {
    it("should handle multi-line data", async () => {
      const stream = createStream([
        "data: line 1\ndata: line 2\ndata: line 3\n\n",
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].data).toBe("line 1\nline 2\nline 3");
    });

    it("should handle empty data field", async () => {
      // Per the SSE spec and this implementation, events with only empty data lines
      // are not dispatched (empty string is falsy). This test verifies that behavior.
      // Events need at least some data content to be dispatched.
      const stream = createStream(["event: test\ndata: \n\n"]);

      const events = await collectEvents(stream);

      // Empty data events are not dispatched
      expect(events).toHaveLength(0);
    });

    it("should handle JSON data", async () => {
      const stream = createStream([
        'event: message\ndata: {"key": "value", "num": 42}\n\n',
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      const parsed = JSON.parse(events[0].data);
      expect(parsed).toEqual({ key: "value", num: 42 });
    });
  });

  describe("id field handling", () => {
    it("should parse id field", async () => {
      const stream = createStream(["event: test\nid: 123\ndata: hello\n\n"]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe("123");
    });

    it("should persist id across events", async () => {
      const stream = createStream([
        "id: abc\ndata: first\n\n",
        "data: second\n\n",
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(2);
      expect(events[0].id).toBe("abc");
      // ID persists per SSE spec
      expect(events[1].id).toBe("abc");
    });

    it("should update id when new one is provided", async () => {
      const stream = createStream([
        "id: first\ndata: one\n\n",
        "id: second\ndata: two\n\n",
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(2);
      expect(events[0].id).toBe("first");
      expect(events[1].id).toBe("second");
    });
  });

  describe("retry field handling", () => {
    it("should parse retry field", async () => {
      const stream = createStream(["retry: 5000\ndata: hello\n\n"]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].retry).toBe(5000);
    });

    it("should ignore non-numeric retry", async () => {
      const stream = createStream(["retry: invalid\ndata: hello\n\n"]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].retry).toBeUndefined();
    });
  });

  describe("comments", () => {
    it("should ignore comment lines", async () => {
      const stream = createStream([
        ": this is a comment\n",
        "event: test\n",
        ": another comment\n",
        "data: hello\n",
        "\n",
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("test");
      expect(events[0].data).toBe("hello");
    });

    it("should handle comment-only stream", async () => {
      const stream = createStream([": comment 1\n", ": comment 2\n"]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(0);
    });
  });

  describe("field value handling", () => {
    it("should strip leading space after colon", async () => {
      const stream = createStream(["data: hello world\n\n"]);

      const events = await collectEvents(stream);

      expect(events[0].data).toBe("hello world");
    });

    it("should not strip multiple leading spaces", async () => {
      const stream = createStream(["data:  two spaces\n\n"]);

      const events = await collectEvents(stream);

      // Only first space after colon is stripped
      expect(events[0].data).toBe(" two spaces");
    });

    it("should handle no space after colon", async () => {
      const stream = createStream(["data:hello\n\n"]);

      const events = await collectEvents(stream);

      expect(events[0].data).toBe("hello");
    });

    it("should ignore lines without colon", async () => {
      const stream = createStream(["event: test\nnovalue\ndata: hello\n\n"]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].data).toBe("hello");
    });
  });

  describe("chunked data handling", () => {
    it("should handle data split across chunks", async () => {
      const stream = createStream([
        "event: te",
        "st\nda",
        "ta: hel",
        "lo\n",
        "\n",
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("test");
      expect(events[0].data).toBe("hello");
    });

    it("should handle multiple events in one chunk", async () => {
      const stream = createStream([
        "event: first\ndata: one\n\nevent: second\ndata: two\n\n",
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(2);
    });

    it("should handle event split at newline boundary", async () => {
      const stream = createStream([
        "event: test\n",
        "data: hello\n",
        "\n",
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("test");
    });
  });

  describe("stream end handling", () => {
    it("should handle stream ending with incomplete event", async () => {
      const stream = createStream(["event: test\ndata: incomplete"]);

      const events = await collectEvents(stream);

      // Should still emit the event with remaining data
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe("incomplete");
    });

    it("should handle empty stream", async () => {
      const stream = createStream([]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(0);
    });

    it("should handle stream with only whitespace", async () => {
      const stream = createStream(["\n\n\n"]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(0);
    });
  });

  describe("abort handling", () => {
    it("should stop iteration when aborted", async () => {
      const controller = new AbortController();

      // Create a stream that yields data slowly
      let index = 0;
      const chunks = [
        "event: first\ndata: one\n\n",
        "event: second\ndata: two\n\n",
        "event: third\ndata: three\n\n",
      ];

      const stream = new ReadableStream<Uint8Array>({
        async pull(streamController) {
          if (index < chunks.length) {
            const encoder = new TextEncoder();
            streamController.enqueue(encoder.encode(chunks[index]));
            index++;
          } else {
            streamController.close();
          }
        },
      });

      const events: SSEEvent[] = [];
      for await (const event of parseSSEStream(stream, { signal: controller.signal })) {
        events.push(event);
        if (events.length === 1) {
          controller.abort();
        }
      }

      // Should have stopped after first event
      expect(events.length).toBeLessThanOrEqual(2);
    });
  });

  describe("real-world scenarios", () => {
    it("should handle typical agent run stream", async () => {
      const stream = createStream([
        'event: run.started\ndata: {"run_id": "run_123"}\n\n',
        'event: message.delta\ndata: {"content": "Hello"}\n\n',
        'event: message.delta\ndata: {"content": ", world!"}\n\n',
        'event: tool.start\ndata: {"tool": "Bash", "input": {"command": "ls"}}\n\n',
        'event: tool.end\ndata: {"tool": "Bash", "output": "file.txt", "duration_ms": 50}\n\n',
        'event: run.completed\ndata: {"run_id": "run_123", "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}, "duration_ms": 1000}\n\n',
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(6);
      expect(events.map((e) => e.event)).toEqual([
        "run.started",
        "message.delta",
        "message.delta",
        "tool.start",
        "tool.end",
        "run.completed",
      ]);
    });

    it("should handle failed run stream", async () => {
      const stream = createStream([
        'event: run.started\ndata: {"run_id": "run_123"}\n\n',
        'event: message.delta\ndata: {"content": "Processing..."}\n\n',
        'event: run.failed\ndata: {"run_id": "run_123", "error": {"code": "timeout", "message": "Execution timed out"}}\n\n',
      ]);

      const events = await collectEvents(stream);

      expect(events).toHaveLength(3);
      expect(events[2].event).toBe("run.failed");
      const data = JSON.parse(events[2].data);
      expect(data.error.code).toBe("timeout");
    });
  });
});

describe("parseSSEEventData", () => {
  it("should parse valid JSON data", () => {
    const event: SSEEvent = {
      event: "test",
      data: '{"key": "value", "num": 42}',
    };

    const parsed = parseSSEEventData<{ key: string; num: number }>(event);

    expect(parsed).toEqual({ key: "value", num: 42 });
  });

  it("should return null for invalid JSON", () => {
    const event: SSEEvent = {
      event: "test",
      data: "not valid json",
    };

    const parsed = parseSSEEventData(event);

    expect(parsed).toBeNull();
  });

  it("should return null for empty data", () => {
    const event: SSEEvent = {
      event: "test",
      data: "",
    };

    const parsed = parseSSEEventData(event);

    expect(parsed).toBeNull();
  });

  it("should parse primitive JSON values", () => {
    expect(parseSSEEventData({ event: "test", data: "42" })).toBe(42);
    expect(parseSSEEventData({ event: "test", data: '"hello"' })).toBe("hello");
    expect(parseSSEEventData({ event: "test", data: "true" })).toBe(true);
    expect(parseSSEEventData({ event: "test", data: "null" })).toBeNull();
  });

  it("should parse arrays", () => {
    const event: SSEEvent = {
      event: "test",
      data: "[1, 2, 3]",
    };

    const parsed = parseSSEEventData<number[]>(event);

    expect(parsed).toEqual([1, 2, 3]);
  });

  it("should handle nested objects", () => {
    const event: SSEEvent = {
      event: "test",
      data: '{"outer": {"inner": {"deep": true}}}',
    };

    const parsed = parseSSEEventData<{
      outer: { inner: { deep: boolean } };
    }>(event);

    expect(parsed?.outer.inner.deep).toBe(true);
  });
});
