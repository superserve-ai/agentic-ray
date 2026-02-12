/**
 * Cross-platform SSE (Server-Sent Events) parser.
 *
 * Works in both Node.js and browser environments using native fetch.
 */

/**
 * Parsed SSE event.
 */
export interface SSEEvent {
  /** Event type (from 'event:' field). */
  event: string;
  /** Event data (from 'data:' field). */
  data: string;
  /** Event ID (from 'id:' field). */
  id?: string;
  /** Retry interval (from 'retry:' field). */
  retry?: number;
}

/**
 * Options for the SSE parser.
 */
export interface SSEParserOptions {
  /** AbortSignal to cancel the stream. */
  signal?: AbortSignal;
}

/**
 * Parse SSE events from a ReadableStream.
 *
 * This parser handles the SSE wire format:
 * - Lines starting with 'event:' set the event type
 * - Lines starting with 'data:' add to the data buffer
 * - Empty lines dispatch the event
 * - Lines starting with ':' are comments (ignored)
 *
 * @param stream - ReadableStream from fetch response body
 * @param options - Parser options
 * @yields SSEEvent objects
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  options?: SSEParserOptions
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let eventType = "message"; // Default event type per SSE spec
  let dataBuffer = "";
  let eventId: string | undefined;
  let retryInterval: number | undefined;

  try {
    while (true) {
      // Check if aborted
      if (options?.signal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining data
        if (buffer.trim()) {
          const lines = buffer.split("\n");
          for (const line of lines) {
            processLine(line);
          }
          // Dispatch final event if we have data
          if (dataBuffer) {
            yield createEvent();
          }
        }
        break;
      }

      // Decode the chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          // Empty line means dispatch the event
          if (dataBuffer) {
            yield createEvent();
          }
        } else {
          processLine(line);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  function processLine(line: string): void {
    if (line.startsWith(":")) {
      // Comment, ignore
      return;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      // Field name with no value
      return;
    }

    const field = line.substring(0, colonIndex);
    // Skip optional space after colon per SSE spec
    let value = line.substring(colonIndex + 1);
    if (value.startsWith(" ")) {
      value = value.substring(1);
    }

    switch (field) {
      case "event":
        eventType = value;
        break;
      case "data":
        // Multiple data fields are concatenated with newlines
        if (dataBuffer) {
          dataBuffer += "\n" + value;
        } else {
          dataBuffer = value;
        }
        break;
      case "id":
        eventId = value;
        break;
      case "retry":
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed)) {
          retryInterval = parsed;
        }
        break;
    }
  }

  function createEvent(): SSEEvent {
    const event: SSEEvent = {
      event: eventType,
      data: dataBuffer,
    };

    if (eventId !== undefined) {
      event.id = eventId;
    }
    if (retryInterval !== undefined) {
      event.retry = retryInterval;
    }

    // Reset for next event
    eventType = "message";
    dataBuffer = "";
    // ID persists until explicitly set again per SSE spec

    return event;
  }
}

/**
 * Parse JSON data from an SSE event.
 *
 * @param event - SSE event to parse
 * @returns Parsed JSON data, or null if parsing fails
 */
export function parseSSEEventData<T = unknown>(event: SSEEvent): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}
