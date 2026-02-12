/**
 * Main Superserve client.
 */

import { AgentsAPI } from "./agents.js";
import { RunsAPI } from "./runs.js";

/**
 * Default API base URL.
 */
export const DEFAULT_BASE_URL = "https://api.superserve.ai";

/**
 * Environment variable name for the API key.
 */
export const API_KEY_ENV_VAR = "SUPERSERVE_API_KEY";

/**
 * Environment variable name for the base URL.
 */
export const BASE_URL_ENV_VAR = "SUPERSERVE_BASE_URL";

/**
 * Configuration options for the Superserve client.
 */
export interface ClientOptions {
  /**
   * API key for authentication.
   *
   * If not provided, will be read from the SUPERSERVE_API_KEY environment variable.
   */
  apiKey?: string;

  /**
   * Base URL for the API.
   *
   * If not provided, will be read from the SUPERSERVE_BASE_URL environment variable,
   * or default to https://api.superserve.ai.
   */
  baseUrl?: string;

  /**
   * Additional headers to include in all requests.
   */
  headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds.
   *
   * Note: This only affects non-streaming requests. Streaming requests
   * use the agent's configured timeout.
   */
  timeout?: number;
}

/**
 * Internal client configuration (resolved from options).
 */
export interface ClientConfig {
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
}

/**
 * Get environment variable value.
 * Works in both Node.js and browser (with bundler support).
 */
function getEnvVar(name: string): string | undefined {
  // Node.js
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  // Browser with bundler (e.g., Vite, webpack)
  // Use dynamic access to avoid TypeScript errors
  const meta = import.meta as { env?: Record<string, string | undefined> };
  if (meta.env) {
    return meta.env[name];
  }
  return undefined;
}

/**
 * The main Superserve SDK client.
 *
 * @example
 * ```typescript
 * import { SuperserveClient } from '@superserve/sdk';
 *
 * const client = new SuperserveClient({
 *   apiKey: 'your-api-key'
 * });
 *
 * // Create an agent
 * const agent = await client.agents.create({
 *   name: 'my-agent',
 *   model: 'claude-sonnet-4-20250514',
 *   systemPrompt: 'You are a helpful assistant.',
 *   tools: ['Bash', 'Read', 'Write']
 * });
 *
 * // Run the agent
 * const output = await client.runs.run({
 *   agentId: agent.id,
 *   prompt: 'Hello, world!'
 * });
 *
 * console.log(output);
 * ```
 */
export class SuperserveClient {
  /** API client for managing agents. */
  readonly agents: AgentsAPI;

  /** API client for managing runs. */
  readonly runs: RunsAPI;

  private readonly config: ClientConfig;

  /**
   * Create a new Superserve client.
   *
   * @param options - Client configuration options
   * @throws {Error} If no API key is provided and SUPERSERVE_API_KEY is not set
   */
  constructor(options: ClientOptions = {}) {
    // Resolve API key
    const apiKey = options.apiKey ?? getEnvVar(API_KEY_ENV_VAR);
    if (!apiKey) {
      throw new Error(
        `API key is required. Provide it via options.apiKey or set the ${API_KEY_ENV_VAR} environment variable.`
      );
    }

    // Resolve base URL
    const baseUrl = (
      options.baseUrl ??
      getEnvVar(BASE_URL_ENV_VAR) ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");

    this.config = {
      apiKey,
      baseUrl,
      headers: options.headers ?? {},
      timeout: options.timeout ?? 30000,
    };

    // Initialize API clients
    this.agents = new AgentsAPI(this.config);
    this.runs = new RunsAPI(this.config);
  }

  /**
   * Get the configured base URL.
   */
  get baseUrl(): string {
    return this.config.baseUrl;
  }
}

/**
 * Create a new Superserve client.
 *
 * Convenience function that creates a new SuperserveClient instance.
 *
 * @param options - Client configuration options
 * @returns A new SuperserveClient instance
 *
 * @example
 * ```typescript
 * import { createClient } from '@superserve/sdk';
 *
 * const client = createClient({ apiKey: 'your-api-key' });
 * ```
 */
export function createClient(options?: ClientOptions): SuperserveClient {
  return new SuperserveClient(options);
}
