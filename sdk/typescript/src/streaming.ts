/**
 * Streaming run implementation.
 */

import {
  RunCancelledError,
  RunFailedError,
  StreamAbortedError,
  SuperserveAPIError,
} from "./errors.js";
import type {
  RunEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RawSSEEventData,
} from "./types/events.js";
import { parseRunEvent } from "./types/events.js";
import type { Run } from "./types/runs.js";
import { parseSSEStream, parseSSEEventData } from "./utils/sse.js";

/**
 * Options for creating a RunStream.
 */
export interface RunStreamOptions {
  /** The run being streamed. */
  run: Run;
  /** The response from the streaming request. */
  response: Response;
  /** AbortController for the stream. */
  abortController: AbortController;
}

/**
 * A streaming run that implements AsyncIterable<RunEvent>.
 *
 * Use `for await` to iterate over events, or use helper methods
 * to consume the stream in different ways.
 *
 * @example
 * ```typescript
 * const stream = await client.runs.stream({ agentId, prompt });
 *
 * // Iterate over events
 * for await (const event of stream) {
 *   if (event.type === 'message.delta') {
 *     process.stdout.write(event.content);
 *   }
 * }
 *
 * // Or use helper methods
 * const result = await stream.finalMessage();
 * console.log(result);
 * ```
 */
export class RunStream implements AsyncIterable<RunEvent> {
  /** The run being streamed. */
  readonly run: Run;

  private readonly response: Response;
  private readonly abortController: AbortController;
  private consumed = false;
  private accumulatedContent = "";
  private completionEvent: RunCompletedEvent | null = null;
  private failureEvent: RunFailedEvent | null = null;

  /** @internal */
  constructor(options: RunStreamOptions) {
    this.run = options.run;
    this.response = options.response;
    this.abortController = options.abortController;
  }

  /**
   * Iterate over run events.
   *
   * @yields RunEvent objects
   * @throws {RunFailedError} If the run fails
   * @throws {RunCancelledError} If the run is cancelled
   * @throws {StreamAbortedError} If the stream is aborted
   */
  async *[Symbol.asyncIterator](): AsyncIterator<RunEvent> {
    if (this.consumed) {
      throw new SuperserveAPIError("Stream has already been consumed", 400);
    }
    this.consumed = true;

    if (!this.response.body) {
      throw new SuperserveAPIError("Response body is null", 500);
    }

    try {
      for await (const sseEvent of parseSSEStream(this.response.body, {
        signal: this.abortController.signal,
      })) {
        const data = parseSSEEventData<RawSSEEventData>(sseEvent);
        if (!data) continue;

        const event = parseRunEvent(sseEvent.event, data);
        if (!event) continue;

        // Track content for finalMessage()
        if (event.type === "message.delta") {
          this.accumulatedContent += event.content;
        }

        // Store terminal events
        if (event.type === "run.completed") {
          this.completionEvent = event;
        } else if (event.type === "run.failed") {
          this.failureEvent = event;
        }

        yield event;

        // Handle terminal events
        if (event.type === "run.failed") {
          throw new RunFailedError(
            event.error.message,
            event.runId,
            event.error.code
          );
        }

        if (event.type === "run.cancelled") {
          throw new RunCancelledError(event.runId);
        }
      }
    } catch (error) {
      if (this.abortController.signal.aborted) {
        throw new StreamAbortedError("Stream was aborted");
      }
      throw error;
    }
  }

  /**
   * Abort the stream.
   *
   * This will cancel the underlying request and stop iteration.
   */
  abort(): void {
    this.abortController.abort();
  }

  /**
   * Get the AbortSignal for this stream.
   *
   * Useful for chaining with other abortable operations.
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Consume the stream and return the final accumulated message.
   *
   * @returns The complete message output
   * @throws {RunFailedError} If the run fails
   * @throws {RunCancelledError} If the run is cancelled
   */
  async finalMessage(): Promise<string> {
    // Consume all events
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of this) {
      // Events are processed in the iterator
    }
    return this.accumulatedContent;
  }

  /**
   * Consume the stream and return all events as an array.
   *
   * @returns Array of all events
   * @throws {RunFailedError} If the run fails
   * @throws {RunCancelledError} If the run is cancelled
   */
  async allEvents(): Promise<RunEvent[]> {
    const events: RunEvent[] = [];
    for await (const event of this) {
      events.push(event);
    }
    return events;
  }

  /**
   * Pipe text deltas to a writable stream.
   *
   * @param writable - A writable stream (e.g., process.stdout)
   * @returns Promise that resolves when streaming is complete
   */
  async pipeTo(writable: { write(chunk: string): boolean | void }): Promise<void> {
    for await (const event of this) {
      if (event.type === "message.delta") {
        writable.write(event.content);
      }
    }
  }

  /**
   * Call a callback for each text delta.
   *
   * @param callback - Function to call with each text chunk
   * @returns Promise that resolves when streaming is complete
   */
  async onText(callback: (text: string) => void): Promise<void> {
    for await (const event of this) {
      if (event.type === "message.delta") {
        callback(event.content);
      }
    }
  }

  /**
   * Get completion metrics (only available after stream is consumed).
   */
  get metrics(): RunCompletedEvent | null {
    return this.completionEvent;
  }

  /**
   * Get failure details (only available if run failed).
   */
  get failure(): RunFailedEvent | null {
    return this.failureEvent;
  }
}
