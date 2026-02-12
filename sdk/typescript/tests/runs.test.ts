/**
 * Tests for RunsAPI.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SuperserveClient,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  RunFailedError,
} from "../src/index.js";
import {
  mockFetch,
  setupMockFetch,
  createMockRun,
  createMockRunEvents,
  createMockRunFailedEvents,
} from "./setup.js";

describe("RunsAPI", () => {
  setupMockFetch();

  let client: SuperserveClient;

  beforeEach(() => {
    client = new SuperserveClient({ apiKey: "test-api-key" });
  });

  describe("stream", () => {
    it("should create a run and return a stream", async () => {
      const mockRun = createMockRun({ id: "run_new123", status: "running" });
      mockFetch.onJson("/runs", mockRun, 201);
      mockFetch.onStream("/runs/run_new123/events", createMockRunEvents("run_new123"));

      const stream = await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Hello, world!",
      });

      expect(stream.run.id).toBe("run_new123");
    });

    it("should send correct request body", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      await client.runs.stream({
        agentId: "agt_test123",
        prompt: "Test prompt",
        sessionId: "sess_abc",
      });

      const createCall = mockFetch.callsTo("/runs")[0];
      const body = JSON.parse(createCall?.init?.body as string);

      expect(body).toEqual({
        agent_id: "agt_test123",
        prompt: "Test prompt",
        session_id: "sess_abc",
      });
    });

    it("should normalize agent ID without prefix", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      await client.runs.stream({
        agentId: "test123",
        prompt: "Hello",
      });

      const createCall = mockFetch.callsTo("/runs")[0];
      const body = JSON.parse(createCall?.init?.body as string);

      expect(body.agent_id).toBe("agt_test123");
    });

    it("should throw NotFoundError for non-existent agent", async () => {
      mockFetch.onError("/runs", 404, "Agent not found");

      await expect(
        client.runs.stream({ agentId: "agt_notfound", prompt: "Hello" })
      ).rejects.toThrow(NotFoundError);
    });

    it("should throw AuthenticationError for invalid credentials", async () => {
      mockFetch.onError("/runs", 401, "Invalid API key");

      await expect(
        client.runs.stream({ agentId: "agt_test123", prompt: "Hello" })
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("run", () => {
    it("should run and return final message", async () => {
      mockFetch.onJson("/runs", createMockRun(), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunEvents());

      const output = await client.runs.run({
        agentId: "agt_test123",
        prompt: "Hello",
      });

      expect(output).toBe("Hello, world!");
    });

    it("should throw RunFailedError when run fails", async () => {
      mockFetch.onJson("/runs", createMockRun({ status: "running" }), 201);
      mockFetch.onStream("/runs/run_test123/events", createMockRunFailedEvents());

      await expect(
        client.runs.run({ agentId: "agt_test123", prompt: "Hello" })
      ).rejects.toThrow(RunFailedError);
    });
  });

  describe("get", () => {
    it("should get a run by ID", async () => {
      const mockRun = createMockRun({ id: "run_abc123" });
      mockFetch.onJson("/runs/run_abc123", mockRun);

      const run = await client.runs.get("run_abc123");

      expect(run.id).toBe("run_abc123");
      mockFetch.assertCalledWith("/runs/run_abc123", { method: "GET" });
    });

    it("should normalize run ID without prefix", async () => {
      mockFetch.onJson("/runs/run_abc123", createMockRun({ id: "run_abc123" }));

      await client.runs.get("abc123");

      mockFetch.assertCalledWith("/runs/run_abc123");
    });

    it("should not double-prefix run ID", async () => {
      mockFetch.onJson("/runs/run_abc123", createMockRun({ id: "run_abc123" }));

      await client.runs.get("run_abc123");

      const calls = mockFetch.callsTo("/runs/run_");
      expect(calls.some((c) => c.url.includes("run_run_"))).toBe(false);
    });

    it("should throw NotFoundError for non-existent run", async () => {
      mockFetch.onError("/runs/run_notfound", 404, "Run not found");

      await expect(client.runs.get("run_notfound")).rejects.toThrow(NotFoundError);
    });
  });

  describe("list", () => {
    it("should list runs without options", async () => {
      const mockRuns = [
        createMockRun({ id: "run_1" }),
        createMockRun({ id: "run_2" }),
      ];
      mockFetch.onJson("/runs", { runs: mockRuns });

      const runs = await client.runs.list();

      expect(runs).toHaveLength(2);
      expect(runs[0].id).toBe("run_1");
      expect(runs[1].id).toBe("run_2");
    });

    it("should list runs with agent filter", async () => {
      mockFetch.onJson("/runs", { runs: [createMockRun()] });

      await client.runs.list({ agentId: "agt_test123" });

      const call = mockFetch.lastCall;
      expect(call?.url).toContain("agent_id=agt_test123");
    });

    it("should normalize agent ID in filter", async () => {
      mockFetch.onJson("/runs", { runs: [] });

      await client.runs.list({ agentId: "test123" });

      const call = mockFetch.lastCall;
      expect(call?.url).toContain("agent_id=agt_test123");
    });

    it("should list runs with status filter", async () => {
      mockFetch.onJson("/runs", { runs: [] });

      await client.runs.list({ status: "completed" });

      const call = mockFetch.lastCall;
      expect(call?.url).toContain("status=completed");
    });

    it("should list runs with pagination", async () => {
      mockFetch.onJson("/runs", { runs: [] });

      await client.runs.list({ limit: 25, offset: 50 });

      const call = mockFetch.lastCall;
      expect(call?.url).toContain("limit=25");
      expect(call?.url).toContain("offset=50");
    });

    it("should combine multiple filters", async () => {
      mockFetch.onJson("/runs", { runs: [] });

      await client.runs.list({
        agentId: "agt_test",
        status: "running",
        limit: 10,
        offset: 0,
      });

      const call = mockFetch.lastCall;
      expect(call?.url).toContain("agent_id=agt_test");
      expect(call?.url).toContain("status=running");
      expect(call?.url).toContain("limit=10");
      expect(call?.url).toContain("offset=0");
    });

    it("should return empty array when no runs", async () => {
      mockFetch.onJson("/runs", { runs: [] });

      const runs = await client.runs.list();

      expect(runs).toEqual([]);
    });
  });

  describe("cancel", () => {
    it("should cancel a running run", async () => {
      const mockRun = createMockRun({ id: "run_abc123", status: "cancelled" });
      mockFetch.onJson("/runs/run_abc123/cancel", mockRun);

      const run = await client.runs.cancel("run_abc123");

      expect(run.status).toBe("cancelled");
      mockFetch.assertCalledWith("/runs/run_abc123/cancel", { method: "POST" });
    });

    it("should normalize run ID", async () => {
      mockFetch.onJson("/runs/run_abc123/cancel", createMockRun());

      await client.runs.cancel("abc123");

      mockFetch.assertCalledWith("/runs/run_abc123/cancel");
    });

    it("should throw NotFoundError for non-existent run", async () => {
      mockFetch.onError("/runs/run_notfound/cancel", 404, "Run not found");

      await expect(client.runs.cancel("run_notfound")).rejects.toThrow(NotFoundError);
    });

    it("should throw ConflictError for completed run", async () => {
      mockFetch.onError("/runs/run_completed/cancel", 409, "Run already completed");

      await expect(client.runs.cancel("run_completed")).rejects.toThrow(ConflictError);
    });
  });

  describe("resumeStream", () => {
    it("should resume streaming for existing run", async () => {
      const mockRun = createMockRun({ id: "run_abc123", status: "running" });
      mockFetch.onJson("/runs/run_abc123", mockRun);
      mockFetch.onStream("/runs/run_abc123/events", createMockRunEvents("run_abc123"));

      const stream = await client.runs.resumeStream("run_abc123");

      expect(stream.run.id).toBe("run_abc123");
    });

    it("should throw NotFoundError for non-existent run", async () => {
      mockFetch.onError("/runs/run_notfound", 404, "Run not found");

      await expect(client.runs.resumeStream("run_notfound")).rejects.toThrow(NotFoundError);
    });
  });

  describe("field mapping", () => {
    it("should correctly map API response fields to SDK fields", async () => {
      const apiResponse = {
        id: "run_test",
        agent_id: "agt_test",
        status: "completed",
        prompt: "Test prompt",
        output: "Test output",
        error_message: null,
        session_id: "sess_123",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
        },
        turns: 3,
        duration_ms: 2500,
        tools_used: ["Bash", "Read"],
        created_at: "2024-06-15T10:30:00Z",
        started_at: "2024-06-15T10:30:01Z",
        completed_at: "2024-06-15T10:30:03Z",
      };
      mockFetch.onJson("/runs/run_test", apiResponse);

      const run = await client.runs.get("run_test");

      expect(run.id).toBe("run_test");
      expect(run.agentId).toBe("agt_test");
      expect(run.status).toBe("completed");
      expect(run.prompt).toBe("Test prompt");
      expect(run.output).toBe("Test output");
      expect(run.errorMessage).toBeNull();
      expect(run.sessionId).toBe("sess_123");
      expect(run.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
      expect(run.turns).toBe(3);
      expect(run.durationMs).toBe(2500);
      expect(run.toolsUsed).toEqual(["Bash", "Read"]);
      expect(run.createdAt).toBe("2024-06-15T10:30:00Z");
      expect(run.startedAt).toBe("2024-06-15T10:30:01Z");
      expect(run.completedAt).toBe("2024-06-15T10:30:03Z");
    });

    it("should handle null usage", async () => {
      const apiResponse = createMockRun({ usage: null });
      mockFetch.onJson("/runs/run_test", apiResponse);

      const run = await client.runs.get("run_test");

      expect(run.usage).toBeNull();
    });

    it("should handle failed run", async () => {
      const apiResponse = createMockRun({
        status: "failed",
        output: null,
        error_message: "Execution timeout",
      });
      mockFetch.onJson("/runs/run_test", apiResponse);

      const run = await client.runs.get("run_test");

      expect(run.status).toBe("failed");
      expect(run.output).toBeNull();
      expect(run.errorMessage).toBe("Execution timeout");
    });
  });
});
