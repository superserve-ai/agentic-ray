/**
 * Tests for RunStream.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SuperserveClient,
  RunStream,
  RunFailedError,
  RunCancelledError,
} from "../src/index.js";
import type { RunEvent } from "../src/index.js";
import {
  mockFetch,
  setupMockFetch,
  createMockRun,
  createMockRunEvents,
  createMockRunEventsWithTools,
  createMockRunFailedEvents,
  createMockRunCancelledEvents,
} from "./setup.js";

describe("RunStream", () => {
  setupMockFetch();

  let client: SuperserveClient;

  beforeEach(() => {
    client = new SuperserveClient({ apiKey: "test-api-key" });
  });

  describe("async iteration", () => {
    it("should iterate over all events", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const events: RunEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toHaveLength(4);
      expect(events[0].type).toBe("run.started");
      expect(events[1].type).toBe("message.delta");
      expect(events[2].type).toBe("message.delta");
      expect(events[3].type).toBe("run.completed");
    });

    it("should parse run.started event correctly", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents("run_abc"));

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const events: RunEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const startEvent = events.find((e) => e.type === "run.started");
      expect(startEvent).toBeDefined();
      if (startEvent?.type === "run.started") {
        expect(startEvent.runId).toBe("run_abc");
      }
    });

    it("should parse message.delta events correctly", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const deltas: string[] = [];
      for await (const event of stream) {
        if (event.type === "message.delta") {
          deltas.push(event.content);
        }
      }

      expect(deltas).toEqual(["Hello", ", world!"]);
    });

    it("should parse tool events correctly", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEventsWithTools());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const events: RunEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const toolStart = events.find((e) => e.type === "tool.start");
      expect(toolStart).toBeDefined();
      if (toolStart?.type === "tool.start") {
        expect(toolStart.tool).toBe("Bash");
        expect(toolStart.input).toEqual({ command: "ls" });
      }

      const toolEnd = events.find((e) => e.type === "tool.end");
      expect(toolEnd).toBeDefined();
      if (toolEnd?.type === "tool.end") {
        expect(toolEnd.tool).toBe("Bash");
        expect(toolEnd.output).toBe("file1.txt\nfile2.txt");
        expect(toolEnd.durationMs).toBe(100);
      }
    });

    it("should parse run.completed event correctly", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents("run_xyz"));

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const events: RunEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const completedEvent = events.find((e) => e.type === "run.completed");
      expect(completedEvent).toBeDefined();
      if (completedEvent?.type === "run.completed") {
        expect(completedEvent.runId).toBe("run_xyz");
        expect(completedEvent.usage).toEqual({
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        });
        expect(completedEvent.durationMs).toBe(500);
      }
    });

    it("should throw RunFailedError on failure", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunFailedEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      await expect(async () => {
        for await (const _event of stream) {
          // consume events
        }
      }).rejects.toThrow(RunFailedError);
    });

    it("should include error details in RunFailedError", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream(
        "/runs/run_test123/events",
        createMockRunFailedEvents("run_test123", {
          code: "timeout",
          message: "Execution timed out",
        })
      );

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      try {
        for await (const _event of stream) {
          // consume events
        }
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(RunFailedError);
        const runError = error as RunFailedError;
        expect(runError.message).toBe("Execution timed out");
        expect(runError.code).toBe("timeout");
        expect(runError.runId).toBe("run_test123");
      }
    });

    it("should throw RunCancelledError on cancellation", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunCancelledEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      await expect(async () => {
        for await (const _event of stream) {
          // consume events
        }
      }).rejects.toThrow(RunCancelledError);
    });

    it("should not allow iterating twice", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      // First iteration
      for await (const _event of stream) {
        // consume events
      }

      // Second iteration should throw
      await expect(async () => {
        for await (const _event of stream) {
          // consume events
        }
      }).rejects.toThrow("Stream has already been consumed");
    });
  });

  describe("finalMessage", () => {
    it("should return accumulated message content", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const message = await stream.finalMessage();

      expect(message).toBe("Hello, world!");
    });

    it("should return empty string if no message content", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", [
        { event: "run.started", data: { run_id: "run_test123" } },
        {
          event: "run.completed",
          data: {
            run_id: "run_test123",
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            duration_ms: 100,
          },
        },
      ]);

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const message = await stream.finalMessage();

      expect(message).toBe("");
    });

    it("should throw on failed run", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunFailedEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      await expect(stream.finalMessage()).rejects.toThrow(RunFailedError);
    });
  });

  describe("allEvents", () => {
    it("should return all events as array", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const events = await stream.allEvents();

      expect(events).toHaveLength(4);
      expect(events.map((e) => e.type)).toEqual([
        "run.started",
        "message.delta",
        "message.delta",
        "run.completed",
      ]);
    });
  });

  describe("pipeTo", () => {
    it("should pipe text deltas to writable", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const chunks: string[] = [];
      const mockWritable = {
        write: (chunk: string) => {
          chunks.push(chunk);
        },
      };

      await stream.pipeTo(mockWritable);

      expect(chunks).toEqual(["Hello", ", world!"]);
    });
  });

  describe("onText", () => {
    it("should call callback for each text delta", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      const chunks: string[] = [];
      await stream.onText((text) => chunks.push(text));

      expect(chunks).toEqual(["Hello", ", world!"]);
    });
  });

  describe("metrics", () => {
    it("should be null before stream is consumed", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      expect(stream.metrics).toBeNull();
    });

    it("should contain completion event after stream is consumed", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents("run_abc"));

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      await stream.finalMessage();

      expect(stream.metrics).toBeDefined();
      expect(stream.metrics?.type).toBe("run.completed");
      expect(stream.metrics?.runId).toBe("run_abc");
    });
  });

  describe("failure", () => {
    it("should be null for successful run", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      await stream.finalMessage();

      expect(stream.failure).toBeNull();
    });

    it("should contain failure event after failed run", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream(
        "/runs/run_test123/events",
        createMockRunFailedEvents("run_fail", { code: "error", message: "Failed" })
      );

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      try {
        await stream.finalMessage();
      } catch {
        // Expected
      }

      expect(stream.failure).toBeDefined();
      expect(stream.failure?.type).toBe("run.failed");
      expect(stream.failure?.error.message).toBe("Failed");
    });
  });

  describe("run property", () => {
    it("should expose the run object", async () => {
      const mockRun = createMockRun({ id: "run_xyz789" });
      mockFetch.onJson("/runs", mockRun, 201);
      mockFetch.onStream("/runs/run_xyz789/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      expect(stream.run.id).toBe("run_xyz789");
    });
  });

  describe("abort", () => {
    it("should expose signal property", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      expect(stream.signal).toBeInstanceOf(AbortSignal);
      expect(stream.signal.aborted).toBe(false);
    });

    it("should abort the stream", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      stream.abort();

      expect(stream.signal.aborted).toBe(true);
    });
  });
});
