/**
 * Error classes for the Superserve SDK.
 */

/**
 * Base error class for all Superserve SDK errors.
 */
export class SuperserveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuperserveError";
    // Maintains proper stack trace for where error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when an API request fails.
 */
export class SuperserveAPIError extends SuperserveError {
  /** HTTP status code. */
  readonly status: number;
  /** Error code from the API (if available). */
  readonly code: string | undefined;
  /** Additional error details from the API. */
  readonly details: Record<string, unknown> | undefined;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SuperserveAPIError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /**
   * Create an API error from a fetch Response.
   */
  static async fromResponse(response: Response): Promise<SuperserveAPIError> {
    let message = `API request failed with status ${response.status}`;
    let code: string | undefined;
    let details: Record<string, unknown> | undefined;

    try {
      const body = await response.json();
      if (typeof body === "object" && body !== null) {
        if (typeof body.detail === "string") {
          message = body.detail;
        } else if (typeof body.message === "string") {
          message = body.message;
        }
        if (typeof body.code === "string") {
          code = body.code;
        }
        details = body;
      }
    } catch {
      // If we can't parse the body, use the default message
    }

    return new SuperserveAPIError(message, response.status, code, details);
  }
}

/**
 * Error thrown when authentication fails (401/403).
 */
export class AuthenticationError extends SuperserveAPIError {
  constructor(message: string = "Authentication failed") {
    super(message, 401, "authentication_error");
    this.name = "AuthenticationError";
  }

  /**
   * Create from an API response.
   */
  static async fromResponse(response: Response): Promise<AuthenticationError> {
    let message = "Authentication failed";

    try {
      const body = await response.json();
      if (typeof body === "object" && body !== null) {
        if (typeof body.detail === "string") {
          message = body.detail;
        } else if (typeof body.message === "string") {
          message = body.message;
        }
      }
    } catch {
      // Use default message
    }

    return new AuthenticationError(message);
  }
}

/**
 * Error thrown when a run fails during execution.
 */
export class RunFailedError extends SuperserveError {
  /** The run ID that failed. */
  readonly runId: string;
  /** Error code (e.g., 'timeout', 'execution_error'). */
  readonly code: string | undefined;

  constructor(message: string, runId: string, code?: string) {
    super(message);
    this.name = "RunFailedError";
    this.runId = runId;
    this.code = code;
  }
}

/**
 * Error thrown when a run is cancelled.
 */
export class RunCancelledError extends SuperserveError {
  /** The run ID that was cancelled. */
  readonly runId: string;

  constructor(runId: string) {
    super(`Run ${runId} was cancelled`);
    this.name = "RunCancelledError";
    this.runId = runId;
  }
}

/**
 * Error thrown when a resource is not found (404).
 */
export class NotFoundError extends SuperserveAPIError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "not_found");
    this.name = "NotFoundError";
  }
}

/**
 * Error thrown when there's a conflict (409).
 */
export class ConflictError extends SuperserveAPIError {
  constructor(message: string = "Resource conflict") {
    super(message, 409, "conflict");
    this.name = "ConflictError";
  }
}

/**
 * Error thrown when validation fails (422).
 */
export class ValidationError extends SuperserveAPIError {
  constructor(message: string = "Validation failed", details?: Record<string, unknown>) {
    super(message, 422, "validation_error", details);
    this.name = "ValidationError";
  }
}

/**
 * Error thrown when the stream is aborted.
 */
export class StreamAbortedError extends SuperserveError {
  constructor(message: string = "Stream was aborted") {
    super(message);
    this.name = "StreamAbortedError";
  }
}
