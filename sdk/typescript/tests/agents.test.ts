/**
 * Tests for AgentsAPI.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SuperserveClient, AuthenticationError, NotFoundError, ConflictError, ValidationError } from "../src/index.js";
import { mockFetch, setupMockFetch, createMockAgent } from "./setup.js";

describe("AgentsAPI", () => {
  setupMockFetch();

  let client: SuperserveClient;

  beforeEach(() => {
    client = new SuperserveClient({ apiKey: "test-api-key" });
  });

  describe("create", () => {
    it("should create an agent with minimal config", async () => {
      const mockAgent = createMockAgent({ name: "my-agent" });
      mockFetch.onJson("/agents", mockAgent, 201);

      const agent = await client.agents.create({ name: "my-agent" });

      expect(agent.id).toBe("agt_test123");
      expect(agent.name).toBe("my-agent");
      expect(agent.model).toBe("claude-sonnet-4-20250514");
      expect(agent.tools).toEqual(["Bash", "Read", "Write"]);

      mockFetch.assertCalledWith("/agents", { method: "POST" });
    });

    it("should create an agent with full config", async () => {
      const mockAgent = createMockAgent({
        name: "custom-agent",
        model: "claude-opus-4-20250514",
        system_prompt: "You are a custom assistant.",
        tools: ["Read", "Grep"],
        max_turns: 20,
        timeout_seconds: 600,
      });
      mockFetch.onJson("/agents", mockAgent, 201);

      const agent = await client.agents.create({
        name: "custom-agent",
        model: "claude-opus-4-20250514",
        systemPrompt: "You are a custom assistant.",
        tools: ["Read", "Grep"],
        maxTurns: 20,
        timeoutSeconds: 600,
      });

      expect(agent.model).toBe("claude-opus-4-20250514");
      expect(agent.systemPrompt).toBe("You are a custom assistant.");
      expect(agent.tools).toEqual(["Read", "Grep"]);
      expect(agent.maxTurns).toBe(20);
      expect(agent.timeoutSeconds).toBe(600);
    });

    it("should send correct request body", async () => {
      mockFetch.onJson("/agents", createMockAgent(), 201);

      await client.agents.create({
        name: "test-agent",
        model: "claude-sonnet-4-20250514",
        systemPrompt: "Test prompt",
        tools: ["Bash"],
        maxTurns: 5,
        timeoutSeconds: 120,
      });

      const call = mockFetch.lastCall;
      const body = JSON.parse(call?.init?.body as string);

      expect(body).toEqual({
        name: "test-agent",
        model: "claude-sonnet-4-20250514",
        system_prompt: "Test prompt",
        tools: ["Bash"],
        max_turns: 5,
        timeout_seconds: 120,
      });
    });

    it("should include authorization header", async () => {
      mockFetch.onJson("/agents", createMockAgent(), 201);

      await client.agents.create({ name: "test" });

      const call = mockFetch.lastCall;
      const headers = call?.init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-api-key");
    });

    it("should throw ConflictError for duplicate name", async () => {
      mockFetch.onError("/agents", 409, "Agent with this name already exists");

      await expect(client.agents.create({ name: "existing-agent" })).rejects.toThrow(ConflictError);
    });

    it("should throw ValidationError for invalid config", async () => {
      mockFetch.onError("/agents", 422, "Invalid agent name format");

      await expect(client.agents.create({ name: "INVALID" })).rejects.toThrow(ValidationError);
    });

    it("should throw AuthenticationError for invalid API key", async () => {
      mockFetch.onError("/agents", 401, "Invalid API key");

      await expect(client.agents.create({ name: "test" })).rejects.toThrow(AuthenticationError);
    });
  });

  describe("get", () => {
    it("should get an agent by ID", async () => {
      const mockAgent = createMockAgent({ id: "agt_abc123" });
      mockFetch.onJson("/agents/agt_abc123", mockAgent);

      const agent = await client.agents.get("agt_abc123");

      expect(agent.id).toBe("agt_abc123");
      mockFetch.assertCalledWith("/agents/agt_abc123", { method: "GET" });
    });

    it("should normalize agent ID without prefix", async () => {
      const mockAgent = createMockAgent({ id: "agt_abc123" });
      mockFetch.onJson("/agents/agt_abc123", mockAgent);

      await client.agents.get("abc123");

      mockFetch.assertCalledWith("/agents/agt_abc123");
    });

    it("should not double-prefix agent ID", async () => {
      const mockAgent = createMockAgent({ id: "agt_abc123" });
      mockFetch.onJson("/agents/agt_abc123", mockAgent);

      await client.agents.get("agt_abc123");

      // Should call with agt_abc123, not agt_agt_abc123
      const calls = mockFetch.callsTo("/agents/agt_");
      expect(calls.some((c) => c.url.includes("agt_agt_"))).toBe(false);
    });

    it("should throw NotFoundError for non-existent agent", async () => {
      mockFetch.onError("/agents/agt_notfound", 404, "Agent not found");

      await expect(client.agents.get("agt_notfound")).rejects.toThrow(NotFoundError);
    });

    it("should throw AuthenticationError for forbidden access", async () => {
      mockFetch.onError("/agents/agt_forbidden", 403, "Access denied");

      await expect(client.agents.get("agt_forbidden")).rejects.toThrow(AuthenticationError);
    });
  });

  describe("list", () => {
    it("should list agents without options", async () => {
      const mockAgents = [
        createMockAgent({ id: "agt_1", name: "agent-1" }),
        createMockAgent({ id: "agt_2", name: "agent-2" }),
      ];
      mockFetch.onJson("/agents", { agents: mockAgents });

      const agents = await client.agents.list();

      expect(agents).toHaveLength(2);
      expect(agents[0].id).toBe("agt_1");
      expect(agents[1].id).toBe("agt_2");
    });

    it("should list agents with pagination", async () => {
      mockFetch.onJson("/agents", { agents: [createMockAgent()] });

      await client.agents.list({ limit: 10, offset: 20 });

      const call = mockFetch.lastCall;
      expect(call?.url).toContain("limit=10");
      expect(call?.url).toContain("offset=20");
    });

    it("should return empty array when no agents", async () => {
      mockFetch.onJson("/agents", { agents: [] });

      const agents = await client.agents.list();

      expect(agents).toEqual([]);
    });

    it("should throw AuthenticationError for invalid credentials", async () => {
      mockFetch.onError("/agents", 401, "Unauthorized");

      await expect(client.agents.list()).rejects.toThrow(AuthenticationError);
    });
  });

  describe("update", () => {
    it("should update an agent", async () => {
      const mockAgent = createMockAgent({
        id: "agt_abc123",
        system_prompt: "Updated prompt",
        max_turns: 15,
      });
      mockFetch.onJson("/agents/agt_abc123", mockAgent);

      const agent = await client.agents.update("agt_abc123", {
        systemPrompt: "Updated prompt",
        maxTurns: 15,
      });

      expect(agent.systemPrompt).toBe("Updated prompt");
      expect(agent.maxTurns).toBe(15);
      mockFetch.assertCalledWith("/agents/agt_abc123", { method: "PATCH" });
    });

    it("should only send defined fields", async () => {
      mockFetch.onJson("/agents/agt_abc123", createMockAgent());

      await client.agents.update("agt_abc123", { maxTurns: 20 });

      const call = mockFetch.lastCall;
      const body = JSON.parse(call?.init?.body as string);

      expect(body).toEqual({ max_turns: 20 });
      expect(body.model).toBeUndefined();
      expect(body.system_prompt).toBeUndefined();
    });

    it("should update all fields when provided", async () => {
      mockFetch.onJson("/agents/agt_abc123", createMockAgent());

      await client.agents.update("agt_abc123", {
        model: "claude-opus-4-20250514",
        systemPrompt: "New prompt",
        tools: ["Bash", "Read"],
        maxTurns: 25,
        timeoutSeconds: 900,
      });

      const call = mockFetch.lastCall;
      const body = JSON.parse(call?.init?.body as string);

      expect(body).toEqual({
        model: "claude-opus-4-20250514",
        system_prompt: "New prompt",
        tools: ["Bash", "Read"],
        max_turns: 25,
        timeout_seconds: 900,
      });
    });

    it("should throw NotFoundError for non-existent agent", async () => {
      mockFetch.onError("/agents/agt_notfound", 404, "Agent not found");

      await expect(
        client.agents.update("agt_notfound", { maxTurns: 10 })
      ).rejects.toThrow(NotFoundError);
    });

    it("should throw ValidationError for invalid update", async () => {
      mockFetch.onError("/agents/agt_abc123", 422, "Invalid model");

      await expect(
        client.agents.update("agt_abc123", { model: "invalid" as any })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("delete", () => {
    it("should delete an agent", async () => {
      mockFetch.on("/agents/agt_abc123", { status: 204 });

      await expect(client.agents.delete("agt_abc123")).resolves.toBeUndefined();
      mockFetch.assertCalledWith("/agents/agt_abc123", { method: "DELETE" });
    });

    it("should normalize agent ID", async () => {
      mockFetch.on("/agents/agt_abc123", { status: 204 });

      await client.agents.delete("abc123");

      mockFetch.assertCalledWith("/agents/agt_abc123");
    });

    it("should throw NotFoundError for non-existent agent", async () => {
      mockFetch.onError("/agents/agt_notfound", 404, "Agent not found");

      await expect(client.agents.delete("agt_notfound")).rejects.toThrow(NotFoundError);
    });

    it("should throw AuthenticationError for forbidden delete", async () => {
      mockFetch.onError("/agents/agt_forbidden", 403, "Access denied");

      await expect(client.agents.delete("agt_forbidden")).rejects.toThrow(AuthenticationError);
    });
  });

  describe("field mapping", () => {
    it("should correctly map API response fields to SDK fields", async () => {
      const apiResponse = {
        id: "agt_test",
        name: "test-agent",
        model: "claude-sonnet-4-20250514",
        system_prompt: "Test system prompt",
        tools: ["Bash", "Read", "Write"],
        max_turns: 15,
        timeout_seconds: 450,
        status: "active",
        created_at: "2024-06-15T10:30:00Z",
        updated_at: "2024-06-15T11:00:00Z",
      };
      mockFetch.onJson("/agents/agt_test", apiResponse);

      const agent = await client.agents.get("agt_test");

      expect(agent.id).toBe("agt_test");
      expect(agent.name).toBe("test-agent");
      expect(agent.model).toBe("claude-sonnet-4-20250514");
      expect(agent.systemPrompt).toBe("Test system prompt");
      expect(agent.tools).toEqual(["Bash", "Read", "Write"]);
      expect(agent.maxTurns).toBe(15);
      expect(agent.timeoutSeconds).toBe(450);
      expect(agent.status).toBe("active");
      expect(agent.createdAt).toBe("2024-06-15T10:30:00Z");
      expect(agent.updatedAt).toBe("2024-06-15T11:00:00Z");
    });
  });
});
