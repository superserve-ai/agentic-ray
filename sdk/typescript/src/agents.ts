/**
 * Agents API client.
 */

import type { ClientConfig } from "./client.js";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  SuperserveAPIError,
  ValidationError,
} from "./errors.js";
import type {
  Agent,
  AgentConfig,
  AgentAPIResponse,
  ListAgentsOptions,
  UpdateAgentOptions,
} from "./types/agents.js";
import { agentFromAPI } from "./types/agents.js";

/**
 * API client for managing agents.
 */
export class AgentsAPI {
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
   * Create a new agent.
   *
   * @param config - Agent configuration
   * @returns The created agent
   * @throws {ValidationError} If the configuration is invalid
   * @throws {ConflictError} If an agent with the same name already exists
   * @throws {AuthenticationError} If authentication fails
   */
  async create(config: AgentConfig): Promise<Agent> {
    const response = await fetch(`${this.baseUrl}/agents`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        name: config.name,
        model: config.model ?? "claude-sonnet-4-5-20250929",
        system_prompt: config.systemPrompt ?? "",
        tools: config.tools ?? ["Bash", "Read", "Write", "Glob", "Grep"],
        max_turns: config.maxTurns ?? 10,
        timeout_seconds: config.timeoutSeconds ?? 300,
      }),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = (await response.json()) as AgentAPIResponse;
    return agentFromAPI(data);
  }

  /**
   * Get an agent by ID.
   *
   * @param agentId - The agent ID (with or without 'agt_' prefix)
   * @returns The agent
   * @throws {NotFoundError} If the agent is not found
   * @throws {AuthenticationError} If authentication fails
   */
  async get(agentId: string): Promise<Agent> {
    const id = this.normalizeAgentId(agentId);
    const response = await fetch(`${this.baseUrl}/agents/${id}`, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = (await response.json()) as AgentAPIResponse;
    return agentFromAPI(data);
  }

  /**
   * List all agents.
   *
   * @param options - Pagination options
   * @returns List of agents
   * @throws {AuthenticationError} If authentication fails
   */
  async list(options?: ListAgentsOptions): Promise<Agent[]> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set("limit", options.limit.toString());
    }
    if (options?.offset !== undefined) {
      params.set("offset", options.offset.toString());
    }

    const url = `${this.baseUrl}/agents${params.toString() ? `?${params}` : ""}`;
    const response = await fetch(url, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = (await response.json()) as { agents: AgentAPIResponse[] };
    return data.agents.map(agentFromAPI);
  }

  /**
   * Update an agent.
   *
   * @param agentId - The agent ID
   * @param options - Fields to update
   * @returns The updated agent
   * @throws {NotFoundError} If the agent is not found
   * @throws {ValidationError} If the update is invalid
   * @throws {AuthenticationError} If authentication fails
   */
  async update(agentId: string, options: UpdateAgentOptions): Promise<Agent> {
    const id = this.normalizeAgentId(agentId);

    // Build update payload with only defined fields
    const payload: Record<string, unknown> = {};
    if (options.model !== undefined) {
      payload.model = options.model;
    }
    if (options.systemPrompt !== undefined) {
      payload.system_prompt = options.systemPrompt;
    }
    if (options.tools !== undefined) {
      payload.tools = options.tools;
    }
    if (options.maxTurns !== undefined) {
      payload.max_turns = options.maxTurns;
    }
    if (options.timeoutSeconds !== undefined) {
      payload.timeout_seconds = options.timeoutSeconds;
    }

    const response = await fetch(`${this.baseUrl}/agents/${id}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = (await response.json()) as AgentAPIResponse;
    return agentFromAPI(data);
  }

  /**
   * Delete an agent.
   *
   * This performs a soft delete. The agent will no longer be accessible
   * but its runs and history are preserved.
   *
   * @param agentId - The agent ID
   * @throws {NotFoundError} If the agent is not found
   * @throws {AuthenticationError} If authentication fails
   */
  async delete(agentId: string): Promise<void> {
    const id = this.normalizeAgentId(agentId);
    const response = await fetch(`${this.baseUrl}/agents/${id}`, {
      method: "DELETE",
      headers: this.headers,
    });

    if (!response.ok && response.status !== 204) {
      throw await this.handleError(response);
    }
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
