/**
 * Run type definitions.
 */

import type { UsageMetrics } from "./metrics.js";

/** Run status values. */
export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * Options for creating and running an agent.
 */
export interface CreateRunOptions {
  /** The agent ID to run. */
  agentId: string;
  /** The prompt to send to the agent. */
  prompt: string;
  /** Optional session ID for conversation continuity. */
  sessionId?: string;
}

/**
 * A run resource.
 */
export interface Run {
  /** Unique run identifier (prefixed with 'run_'). */
  id: string;
  /** Agent ID this run belongs to. */
  agentId: string;
  /** Current status of the run. */
  status: RunStatus;
  /** The prompt that was sent. */
  prompt: string;
  /** The output from the agent (if completed). */
  output: string | null;
  /** Error message (if failed). */
  errorMessage: string | null;
  /** Session ID for conversation continuity. */
  sessionId: string | null;
  /** Token usage metrics. */
  usage: UsageMetrics | null;
  /** Number of agent turns. */
  turns: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** List of tools used. */
  toolsUsed: string[];
  /** ISO 8601 timestamp when the run was created. */
  createdAt: string;
  /** ISO 8601 timestamp when the run started. */
  startedAt: string | null;
  /** ISO 8601 timestamp when the run completed. */
  completedAt: string | null;
}

/**
 * Options for listing runs.
 */
export interface ListRunsOptions {
  /** Filter by agent ID. */
  agentId?: string;
  /** Filter by status. */
  status?: RunStatus;
  /** Maximum number of runs to return (1-100). */
  limit?: number;
  /** Number of runs to skip. */
  offset?: number;
}

/**
 * Response from the runs list endpoint.
 */
export interface RunListResponse {
  runs: Run[];
}

/** @internal API response format for runs. */
export interface RunAPIResponse {
  id: string;
  agent_id: string;
  status: string;
  prompt: string;
  output: string | null;
  error_message: string | null;
  session_id: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  } | null;
  turns: number;
  duration_ms: number;
  tools_used: string[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/** @internal Convert API response to Run. */
export function runFromAPI(response: RunAPIResponse): Run {
  return {
    id: response.id,
    agentId: response.agent_id,
    status: response.status as RunStatus,
    prompt: response.prompt,
    output: response.output,
    errorMessage: response.error_message,
    sessionId: response.session_id,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null,
    turns: response.turns,
    durationMs: response.duration_ms,
    toolsUsed: response.tools_used,
    createdAt: response.created_at,
    startedAt: response.started_at,
    completedAt: response.completed_at,
  };
}
