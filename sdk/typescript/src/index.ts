/**
 * Superserve SDK for TypeScript/JavaScript.
 *
 * @packageDocumentation
 */

// Main client
export {
  SuperserveClient,
  createClient,
  type ClientOptions,
  DEFAULT_BASE_URL,
  API_KEY_ENV_VAR,
  BASE_URL_ENV_VAR,
} from "./client.js";

// API clients
export { AgentsAPI } from "./agents.js";
export { RunsAPI } from "./runs.js";

// Streaming
export { RunStream, type RunStreamOptions } from "./streaming.js";

// Types - Agents
export type {
  Agent,
  AgentConfig,
  AgentModel,
  AgentStatus,
  AgentTool,
  ListAgentsOptions,
  UpdateAgentOptions,
  AgentListResponse,
} from "./types/agents.js";

// Types - Runs
export type {
  Run,
  RunStatus,
  CreateRunOptions,
  ListRunsOptions,
  RunListResponse,
} from "./types/runs.js";

// Types - Events
export type {
  RunEvent,
  RunEventType,
  RunStartedEvent,
  MessageDeltaEvent,
  ToolStartEvent,
  ToolEndEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RunCancelledEvent,
  RunError,
} from "./types/events.js";

// Types - Metrics
export type {
  UsageMetrics,
  RunMetrics,
  ToolCall,
} from "./types/metrics.js";

// Errors
export {
  SuperserveError,
  SuperserveAPIError,
  AuthenticationError,
  RunFailedError,
  RunCancelledError,
  NotFoundError,
  ConflictError,
  ValidationError,
  StreamAbortedError,
} from "./errors.js";

// Utilities
export { parseSSEStream, parseSSEEventData, type SSEEvent, type SSEParserOptions } from "./utils/sse.js";
