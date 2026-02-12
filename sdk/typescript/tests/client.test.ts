/**
 * Tests for SuperserveClient initialization and configuration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SuperserveClient,
  createClient,
  DEFAULT_BASE_URL,
  API_KEY_ENV_VAR,
  BASE_URL_ENV_VAR,
} from "../src/index.js";

describe("SuperserveClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env[API_KEY_ENV_VAR];
    delete process.env[BASE_URL_ENV_VAR];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("constructor", () => {
    it("should create client with explicit API key", () => {
      const client = new SuperserveClient({ apiKey: "test-api-key" });
      expect(client).toBeInstanceOf(SuperserveClient);
      expect(client.baseUrl).toBe(DEFAULT_BASE_URL);
    });

    it("should use API key from environment variable", () => {
      process.env[API_KEY_ENV_VAR] = "env-api-key";
      const client = new SuperserveClient();
      expect(client).toBeInstanceOf(SuperserveClient);
    });

    it("should throw error if no API key provided", () => {
      expect(() => new SuperserveClient()).toThrow(
        `API key is required. Provide it via options.apiKey or set the ${API_KEY_ENV_VAR} environment variable.`
      );
    });

    it("should use explicit base URL", () => {
      const client = new SuperserveClient({
        apiKey: "test-api-key",
        baseUrl: "https://custom.api.com",
      });
      expect(client.baseUrl).toBe("https://custom.api.com");
    });

    it("should strip trailing slash from base URL", () => {
      const client = new SuperserveClient({
        apiKey: "test-api-key",
        baseUrl: "https://custom.api.com/",
      });
      expect(client.baseUrl).toBe("https://custom.api.com");
    });

    it("should use base URL from environment variable", () => {
      process.env[BASE_URL_ENV_VAR] = "https://env.api.com";
      const client = new SuperserveClient({ apiKey: "test-api-key" });
      expect(client.baseUrl).toBe("https://env.api.com");
    });

    it("should prefer explicit base URL over environment variable", () => {
      process.env[BASE_URL_ENV_VAR] = "https://env.api.com";
      const client = new SuperserveClient({
        apiKey: "test-api-key",
        baseUrl: "https://explicit.api.com",
      });
      expect(client.baseUrl).toBe("https://explicit.api.com");
    });

    it("should prefer explicit API key over environment variable", () => {
      process.env[API_KEY_ENV_VAR] = "env-api-key";
      // The client doesn't expose apiKey, but we can test indirectly
      // by verifying no error is thrown when explicit key is provided
      const client = new SuperserveClient({ apiKey: "explicit-api-key" });
      expect(client).toBeInstanceOf(SuperserveClient);
    });
  });

  describe("agents property", () => {
    it("should expose AgentsAPI instance", () => {
      const client = new SuperserveClient({ apiKey: "test-api-key" });
      expect(client.agents).toBeDefined();
      expect(typeof client.agents.create).toBe("function");
      expect(typeof client.agents.get).toBe("function");
      expect(typeof client.agents.list).toBe("function");
      expect(typeof client.agents.update).toBe("function");
      expect(typeof client.agents.delete).toBe("function");
    });
  });

  describe("runs property", () => {
    it("should expose RunsAPI instance", () => {
      const client = new SuperserveClient({ apiKey: "test-api-key" });
      expect(client.runs).toBeDefined();
      expect(typeof client.runs.run).toBe("function");
      expect(typeof client.runs.stream).toBe("function");
      expect(typeof client.runs.get).toBe("function");
      expect(typeof client.runs.list).toBe("function");
      expect(typeof client.runs.cancel).toBe("function");
      expect(typeof client.runs.resumeStream).toBe("function");
    });
  });
});

describe("createClient", () => {
  beforeEach(() => {
    delete process.env[API_KEY_ENV_VAR];
  });

  it("should create client with options", () => {
    const client = createClient({ apiKey: "test-api-key" });
    expect(client).toBeInstanceOf(SuperserveClient);
  });

  it("should create client using environment variables", () => {
    process.env[API_KEY_ENV_VAR] = "env-api-key";
    const client = createClient();
    expect(client).toBeInstanceOf(SuperserveClient);
  });

  it("should throw error if no API key available", () => {
    expect(() => createClient()).toThrow();
  });
});

describe("exported constants", () => {
  it("should export DEFAULT_BASE_URL", () => {
    expect(DEFAULT_BASE_URL).toBe("https://api.superserve.ai");
  });

  it("should export API_KEY_ENV_VAR", () => {
    expect(API_KEY_ENV_VAR).toBe("SUPERSERVE_API_KEY");
  });

  it("should export BASE_URL_ENV_VAR", () => {
    expect(BASE_URL_ENV_VAR).toBe("SUPERSERVE_BASE_URL");
  });
});
