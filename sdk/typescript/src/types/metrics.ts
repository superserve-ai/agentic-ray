/**
 * Metrics type definitions.
 */

/**
 * Token usage metrics for a run.
 */
export interface UsageMetrics {
  /** Number of input tokens consumed. */
  inputTokens: number;
  /** Number of output tokens generated. */
  outputTokens: number;
  /** Total tokens (input + output). */
  totalTokens: number;
}

/**
 * Complete metrics for a run.
 */
export interface RunMetrics {
  /** Token usage metrics. */
  usage: UsageMetrics | null;
  /** Number of agent turns. */
  turns: number;
  /** Total run duration in milliseconds. */
  durationMs: number;
  /** List of tools used during the run. */
  toolsUsed: string[];
}

/**
 * Information about a tool call.
 */
export interface ToolCall {
  /** Name of the tool. */
  tool: string;
  /** Input provided to the tool. */
  input: Record<string, unknown>;
  /** Output from the tool (truncated). */
  output?: string;
  /** Duration of the tool call in milliseconds. */
  durationMs?: number;
}
