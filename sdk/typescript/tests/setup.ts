/**
 * Test setup with fetch mocking utilities.
 */

import { vi, beforeEach, afterEach } from "vitest";

/**
 * Mock response configuration.
 */
export interface MockResponseConfig {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** For SSE streams */
  stream?: string[];
}

/**
 * Track all mock fetch calls.
 */
export interface MockFetchCall {
  url: string;
  init?: RequestInit;
}

/**
 * Mock fetch implementation that tracks calls and returns configured responses.
 */
export class MockFetch {
  private responses: Map<string, MockResponseConfig[]> = new Map();
  private defaultResponse: MockResponseConfig = { status: 404, body: { detail: "Not found" } };
  public calls: MockFetchCall[] = [];

  /**
   * Reset all mock state.
   */
  reset(): void {
    this.responses.clear();
    this.calls = [];
  }

  /**
   * Configure a response for a URL pattern.
   * Multiple calls with the same pattern queue responses (consumed in order).
   */
  on(urlPattern: string, response: MockResponseConfig): this {
    const existing = this.responses.get(urlPattern) ?? [];
    existing.push(response);
    this.responses.set(urlPattern, existing);
    return this;
  }

  /**
   * Configure a JSON response.
   */
  onJson(urlPattern: string, body: unknown, status = 200): this {
    return this.on(urlPattern, {
      status,
      headers: { "Content-Type": "application/json" },
      body,
    });
  }

  /**
   * Configure an error response.
   */
  onError(urlPattern: string, status: number, message: string, code?: string): this {
    return this.on(urlPattern, {
      status,
      headers: { "Content-Type": "application/json" },
      body: { detail: message, code },
    });
  }

  /**
   * Configure an SSE stream response.
   */
  onStream(urlPattern: string, events: Array<{ event: string; data: unknown }>): this {
    const lines = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n`);
    return this.on(urlPattern, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      stream: lines,
    });
  }

  /**
   * Set default response for unmatched URLs.
   */
  setDefault(response: MockResponseConfig): this {
    this.defaultResponse = response;
    return this;
  }

  /**
   * Get the fetch implementation.
   */
  get fetch(): typeof globalThis.fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      this.calls.push({ url, init });

      // Find matching response
      let response = this.defaultResponse;
      for (const [pattern, responses] of this.responses) {
        if (url.includes(pattern) && responses.length > 0) {
          response = responses.shift()!;
          if (responses.length === 0) {
            this.responses.delete(pattern);
          }
          break;
        }
      }

      return this.createResponse(response);
    };
  }

  /**
   * Create a Response object from config.
   */
  private createResponse(config: MockResponseConfig): Response {
    const headers = new Headers(config.headers);

    // Handle streaming responses
    if (config.stream) {
      const stream = this.createSSEStream(config.stream);
      return new Response(stream, {
        status: config.status ?? 200,
        statusText: config.statusText ?? "OK",
        headers,
      });
    }

    // Handle regular JSON responses
    const body = config.body !== undefined ? JSON.stringify(config.body) : null;
    return new Response(body, {
      status: config.status ?? 200,
      statusText: config.statusText ?? "OK",
      headers,
    });
  }

  /**
   * Create an SSE ReadableStream.
   */
  private createSSEStream(events: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;

    return new ReadableStream({
      pull(controller) {
        if (index < events.length) {
          controller.enqueue(encoder.encode(events[index] + "\n"));
          index++;
        } else {
          controller.close();
        }
      },
    });
  }

  /**
   * Get the last call made.
   */
  get lastCall(): MockFetchCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  /**
   * Get calls matching a URL pattern.
   */
  callsTo(urlPattern: string): MockFetchCall[] {
    return this.calls.filter((c) => c.url.includes(urlPattern));
  }

  /**
   * Assert a call was made to a URL.
   */
  assertCalledWith(urlPattern: string, options?: { method?: string; body?: unknown }): void {
    const matchingCalls = this.callsTo(urlPattern);
    if (matchingCalls.length === 0) {
      throw new Error(`Expected fetch to be called with URL containing "${urlPattern}", but it wasn't`);
    }

    if (options?.method) {
      const hasMethod = matchingCalls.some((c) => c.init?.method === options.method);
      if (!hasMethod) {
        throw new Error(
          `Expected fetch to be called with method "${options.method}" for URL "${urlPattern}"`
        );
      }
    }

    if (options?.body !== undefined) {
      const hasBody = matchingCalls.some((c) => {
        if (!c.init?.body) return false;
        const parsedBody = JSON.parse(c.init.body as string);
        return JSON.stringify(parsedBody) === JSON.stringify(options.body);
      });
      if (!hasBody) {
        throw new Error(
          `Expected fetch to be called with body ${JSON.stringify(options.body)} for URL "${urlPattern}"`
        );
      }
    }
  }
}

/**
 * Global mock fetch instance.
 */
export const mockFetch = new MockFetch();

/**
 * Install mock fetch globally.
 */
export function installMockFetch(): void {
  vi.stubGlobal("fetch", mockFetch.fetch);
}

/**
 * Restore original fetch.
 */
export function restoreFetch(): void {
  vi.unstubAllGlobals();
}

/**
 * Setup mock fetch for each test.
 */
export function setupMockFetch(): void {
  beforeEach(() => {
    mockFetch.reset();
    installMockFetch();
  });

  afterEach(() => {
    restoreFetch();
  });
}

/**
 * Create a mock agent API response.
 */
export function createMockAgent(overrides: Partial<{
  id: string;
  name: string;
  model: string;
  system_prompt: string;
  tools: string[];
  max_turns: number;
  timeout_seconds: number;
  status: string;
  created_at: string;
  updated_at: string;
}> = {}): Record<string, unknown> {
  return {
    id: "agt_test123",
    name: "test-agent",
    model: "claude-sonnet-4-20250514",
    system_prompt: "You are a test assistant.",
    tools: ["Bash", "Read", "Write"],
    max_turns: 10,
    timeout_seconds: 300,
    status: "active",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Create a mock run API response.
 */
export function createMockRun(overrides: Partial<{
  id: string;
  agent_id: string;
  status: string;
  prompt: string;
  output: string | null;
  error_message: string | null;
  session_id: string | null;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  turns: number;
  duration_ms: number;
  tools_used: string[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}> = {}): Record<string, unknown> {
  return {
    id: "run_test123",
    agent_id: "agt_test123",
    status: "completed",
    prompt: "Hello, world!",
    output: "Hello! How can I help you?",
    error_message: null,
    session_id: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    },
    turns: 1,
    duration_ms: 1500,
    tools_used: [],
    created_at: "2024-01-01T00:00:00Z",
    started_at: "2024-01-01T00:00:01Z",
    completed_at: "2024-01-01T00:00:02Z",
    ...overrides,
  };
}

/**
 * Create mock SSE events for a successful run.
 */
export function createMockRunEvents(runId = "run_test123"): Array<{ event: string; data: unknown }> {
  return [
    { event: "run.started", data: { run_id: runId } },
    { event: "message.delta", data: { content: "Hello" } },
    { event: "message.delta", data: { content: ", world!" } },
    {
      event: "run.completed",
      data: {
        run_id: runId,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        duration_ms: 500,
      },
    },
  ];
}

/**
 * Create mock SSE events with tool usage.
 */
export function createMockRunEventsWithTools(runId = "run_test123"): Array<{ event: string; data: unknown }> {
  return [
    { event: "run.started", data: { run_id: runId } },
    { event: "message.delta", data: { content: "Let me check..." } },
    { event: "tool.start", data: { tool: "Bash", input: { command: "ls" } } },
    { event: "tool.end", data: { tool: "Bash", output: "file1.txt\nfile2.txt", duration_ms: 100 } },
    { event: "message.delta", data: { content: "I found 2 files." } },
    {
      event: "run.completed",
      data: {
        run_id: runId,
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
        duration_ms: 1000,
      },
    },
  ];
}

/**
 * Create mock SSE events for a failed run.
 */
export function createMockRunFailedEvents(
  runId = "run_test123",
  error = { code: "execution_error", message: "Something went wrong" }
): Array<{ event: string; data: unknown }> {
  return [
    { event: "run.started", data: { run_id: runId } },
    { event: "message.delta", data: { content: "Processing..." } },
    { event: "run.failed", data: { run_id: runId, error } },
  ];
}

/**
 * Create mock SSE events for a cancelled run.
 */
export function createMockRunCancelledEvents(runId = "run_test123"): Array<{ event: string; data: unknown }> {
  return [
    { event: "run.started", data: { run_id: runId } },
    { event: "message.delta", data: { content: "Working on it..." } },
    { event: "run.cancelled", data: { run_id: runId } },
  ];
}
