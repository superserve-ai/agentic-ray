/**
 * Runs API client.
 */

import type { ClientConfig } from "./client.js";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  SuperserveAPIError,
  ValidationError,
} from "./errors.js";
import { RunStream } from "./streaming.js";
import type {
  CreateRunOptions,
  ListRunsOptions,
  Run,
  RunAPIResponse,
} from "./types/runs.js";
import { runFromAPI } from "./types/runs.js";

/**
 * API client for managing runs.
 */
export class RunsAPI {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;

  /** @internal */
  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...config.headers,
    };
  }

  /**
   * Create a run and wait for completion.
   *
   * This creates a run, streams the events, and returns the final output.
   * For real-time streaming, use `stream()` instead.
   *
   * @param options - Run options
   * @returns The final output from the agent
   * @throws {RunFailedError} If the run fails
   * @throws {RunCancelledError} If the run is cancelled
   * @throws {NotFoundError} If the agent is not found
   * @throws {AuthenticationError} If authentication fails
   */
  async run(options: CreateRunOptions): Promise<string> {
    const stream = await this.stream(options);
    return stream.finalMessage();
  }

  /**
   * Create a run and return a streaming iterator.
   *
   * @param options - Run options
   * @returns A RunStream that can be iterated over
   * @throws {NotFoundError} If the agent is not found
   * @throws {AuthenticationError} If authentication fails
   *
   * @example
   * ```typescript
   * const stream = await client.runs.stream({
   *   agentId: 'agt_xxx',
   *   prompt: 'Hello, world!'
   * });
   *
   * for await (const event of stream) {
   *   if (event.type === 'message.delta') {
   *     process.stdout.write(event.content);
   *   }
   * }
   * ```
   */
  async stream(options: CreateRunOptions): Promise<RunStream> {
    const agentId = this.normalizeAgentId(options.agentId);

    // First, create the run
    const createResponse = await fetch(`${this.baseUrl}/runs`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        agent_id: agentId,
        prompt: options.prompt,
        session_id: options.sessionId,
      }),
    });

    if (!createResponse.ok) {
      throw await this.handleError(createResponse);
    }

    const run = runFromAPI((await createResponse.json()) as RunAPIResponse);

    // Then stream the events
    const abortController = new AbortController();
    const streamResponse = await fetch(
      `${this.baseUrl}/runs/${run.id}/events`,
      {
        method: "GET",
        headers: {
          ...this.headers,
          Accept: "text/event-stream",
        },
        signal: abortController.signal,
      }
    );

    if (!streamResponse.ok) {
      throw await this.handleError(streamResponse);
    }

    return new RunStream({
      run,
      response: streamResponse,
      abortController,
    });
  }

  /**
   * Get a run by ID.
   *
   * @param runId - The run ID (with or without 'run_' prefix)
   * @returns The run
   * @throws {NotFoundError} If the run is not found
   * @throws {AuthenticationError} If authentication fails
   */
  async get(runId: string): Promise<Run> {
    const id = this.normalizeRunId(runId);
    const response = await fetch(`${this.baseUrl}/runs/${id}`, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = (await response.json()) as RunAPIResponse;
    return runFromAPI(data);
  }

  /**
   * List runs.
   *
   * @param options - Filter and pagination options
   * @returns List of runs
   * @throws {AuthenticationError} If authentication fails
   */
  async list(options?: ListRunsOptions): Promise<Run[]> {
    const params = new URLSearchParams();
    if (options?.agentId !== undefined) {
      params.set("agent_id", this.normalizeAgentId(options.agentId));
    }
    if (options?.status !== undefined) {
      params.set("status", options.status);
    }
    if (options?.limit !== undefined) {
      params.set("limit", options.limit.toString());
    }
    if (options?.offset !== undefined) {
      params.set("offset", options.offset.toString());
    }

    const url = `${this.baseUrl}/runs${params.toString() ? `?${params}` : ""}`;
    const response = await fetch(url, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = (await response.json()) as { runs: RunAPIResponse[] };
    return data.runs.map(runFromAPI);
  }

  /**
   * Cancel a running run.
   *
   * Only runs with status 'pending' or 'running' can be cancelled.
   *
   * @param runId - The run ID
   * @returns The cancelled run
   * @throws {NotFoundError} If the run is not found
   * @throws {ConflictError} If the run cannot be cancelled
   * @throws {AuthenticationError} If authentication fails
   */
  async cancel(runId: string): Promise<Run> {
    const id = this.normalizeRunId(runId);
    const response = await fetch(`${this.baseUrl}/runs/${id}/cancel`, {
      method: "POST",
      headers: this.headers,
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = (await response.json()) as RunAPIResponse;
    return runFromAPI(data);
  }

  /**
   * Resume streaming for an existing run.
   *
   * Useful for reconnecting to a run that's still in progress.
   *
   * @param runId - The run ID
   * @returns A RunStream that can be iterated over
   * @throws {NotFoundError} If the run is not found
   * @throws {AuthenticationError} If authentication fails
   */
  async resumeStream(runId: string): Promise<RunStream> {
    const run = await this.get(runId);

    const abortController = new AbortController();
    const streamResponse = await fetch(
      `${this.baseUrl}/runs/${run.id}/events`,
      {
        method: "GET",
        headers: {
          ...this.headers,
          Accept: "text/event-stream",
        },
        signal: abortController.signal,
      }
    );

    if (!streamResponse.ok) {
      throw await this.handleError(streamResponse);
    }

    return new RunStream({
      run,
      response: streamResponse,
      abortController,
    });
  }

  /**
   * Ensure agent ID has the correct prefix.
   */
  private normalizeAgentId(agentId: string): string {
    if (!agentId.startsWith("agt_")) {
      return `agt_${agentId}`;
    }
    return agentId;
  }

  /**
   * Ensure run ID has the correct prefix.
   */
  private normalizeRunId(runId: string): string {
    if (!runId.startsWith("run_")) {
      return `run_${runId}`;
    }
    return runId;
  }

  /**
   * Handle error responses.
   */
  private async handleError(response: Response): Promise<SuperserveAPIError> {
    if (response.status === 401 || response.status === 403) {
      return AuthenticationError.fromResponse(response);
    }
    if (response.status === 404) {
      const error = await SuperserveAPIError.fromResponse(response);
      return new NotFoundError(error.message);
    }
    if (response.status === 409) {
      const error = await SuperserveAPIError.fromResponse(response);
      return new ConflictError(error.message);
    }
    if (response.status === 422) {
      const error = await SuperserveAPIError.fromResponse(response);
      return new ValidationError(error.message, error.details);
    }
    return SuperserveAPIError.fromResponse(response);
  }
}
