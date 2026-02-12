/**
 * Run event type definitions.
 *
 * These events are emitted during streaming runs via SSE.
 */

import type { UsageMetrics } from "./metrics.js";

/**
 * Event emitted when a run starts.
 */
export interface RunStartedEvent {
  type: "run.started";
  runId: string;
}

/**
 * Event emitted for each chunk of text output.
 */
export interface MessageDeltaEvent {
  type: "message.delta";
  content: string;
}

/**
 * Event emitted when a tool execution starts.
 */
export interface ToolStartEvent {
  type: "tool.start";
  tool: string;
  input: Record<string, unknown>;
}

/**
 * Event emitted when a tool execution completes.
 */
export interface ToolEndEvent {
  type: "tool.end";
  tool: string;
  output: string;
  durationMs: number;
}

/**
 * Event emitted when a run completes successfully.
 */
export interface RunCompletedEvent {
  type: "run.completed";
  runId: string;
  usage: UsageMetrics;
  durationMs: number;
}

/**
 * Error details for run failures.
 */
export interface RunError {
  code?: string;
  message: string;
}

/**
 * Event emitted when a run fails.
 */
export interface RunFailedEvent {
  type: "run.failed";
  runId: string;
  error: RunError;
}

/**
 * Event emitted when a run is cancelled.
 */
export interface RunCancelledEvent {
  type: "run.cancelled";
  runId: string;
}

/**
 * Discriminated union of all run event types.
 */
export type RunEvent =
  | RunStartedEvent
  | MessageDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent;

/**
 * All possible event type strings.
 */
export type RunEventType = RunEvent["type"];

/** @internal Raw SSE event data from API. */
export interface RawSSEEventData {
  run_id?: string;
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  duration_ms?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  error?: {
    code?: string;
    message: string;
  };
}

/** @internal Parse raw SSE event into typed event. */
export function parseRunEvent(
  eventType: string,
  data: RawSSEEventData
): RunEvent | null {
  switch (eventType) {
    case "run.started":
      return {
        type: "run.started",
        runId: data.run_id ?? "",
      };

    case "message.delta":
      return {
        type: "message.delta",
        content: data.content ?? "",
      };

    case "tool.start":
      return {
        type: "tool.start",
        tool: data.tool ?? "",
        input: data.input ?? {},
      };

    case "tool.end":
      return {
        type: "tool.end",
        tool: data.tool ?? "",
        output: data.output ?? "",
        durationMs: data.duration_ms ?? 0,
      };

    case "run.completed":
      return {
        type: "run.completed",
        runId: data.run_id ?? "",
        usage: data.usage
          ? {
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: data.duration_ms ?? 0,
      };

    case "run.failed":
      return {
        type: "run.failed",
        runId: data.run_id ?? "",
        error: data.error ?? { message: "Unknown error" },
      };

    case "run.cancelled":
      return {
        type: "run.cancelled",
        runId: data.run_id ?? "",
      };

    default:
      // Unknown event type, ignore
      return null;
  }
}
