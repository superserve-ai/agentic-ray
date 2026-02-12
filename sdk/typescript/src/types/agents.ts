/**
 * Agent type definitions.
 */

/** Valid models that can be used with agents. */
export type AgentModel =
  | "claude-sonnet-4-5-20250929"
  | "claude-opus-4-6"
  | "claude-haiku-4-5-20251001";

/** Valid tools that can be assigned to agents. */
export type AgentTool =
  | "Bash"
  | "Read"
  | "Write"
  | "Glob"
  | "Grep"
  | "WebSearch"
  | "WebFetch";

/**
 * Configuration for creating a new agent.
 */
export interface AgentConfig {
  /** Agent name (lowercase letters, numbers, hyphens, must start with letter). */
  name: string;
  /** Model to use for the agent. */
  model?: AgentModel;
  /** System prompt for the agent. */
  systemPrompt?: string;
  /** Tools available to the agent. */
  tools?: AgentTool[];
  /** Maximum number of turns per run. */
  maxTurns?: number;
  /** Timeout in seconds for each run. */
  timeoutSeconds?: number;
}

/**
 * Options for updating an existing agent.
 */
export interface UpdateAgentOptions {
  /** Model to use for the agent. */
  model?: AgentModel;
  /** System prompt for the agent. */
  systemPrompt?: string;
  /** Tools available to the agent. */
  tools?: AgentTool[];
  /** Maximum number of turns per run. */
  maxTurns?: number;
  /** Timeout in seconds for each run. */
  timeoutSeconds?: number;
}

/**
 * An agent resource.
 */
export interface Agent {
  /** Unique agent identifier (prefixed with 'agt_'). */
  id: string;
  /** Agent name. */
  name: string;
  /** Model used by the agent. */
  model: AgentModel;
  /** System prompt for the agent. */
  systemPrompt: string;
  /** Tools available to the agent. */
  tools: AgentTool[];
  /** Maximum number of turns per run. */
  maxTurns: number;
  /** Timeout in seconds for each run. */
  timeoutSeconds: number;
  /** ISO 8601 timestamp when the agent was created. */
  createdAt: string;
  /** ISO 8601 timestamp when the agent was last updated. */
  updatedAt: string;
}

/**
 * Options for listing agents.
 */
export interface ListAgentsOptions {
  /** Maximum number of agents to return (1-100). */
  limit?: number;
  /** Number of agents to skip. */
  offset?: number;
}

/**
 * Response from the agents list endpoint.
 */
export interface AgentListResponse {
  agents: Agent[];
}

/** @internal API response format for agents. */
export interface AgentAPIResponse {
  id: string;
  name: string;
  model: string;
  system_prompt: string;
  tools: string[];
  max_turns: number;
  timeout_seconds: number;
  created_at: string;
  updated_at: string;
}

/** @internal Convert API response to Agent. */
export function agentFromAPI(response: AgentAPIResponse): Agent {
  return {
    id: response.id,
    name: response.name,
    model: response.model as AgentModel,
    systemPrompt: response.system_prompt,
    tools: response.tools as AgentTool[],
    maxTurns: response.max_turns,
    timeoutSeconds: response.timeout_seconds,
    createdAt: response.created_at,
    updatedAt: response.updated_at,
  };
}
