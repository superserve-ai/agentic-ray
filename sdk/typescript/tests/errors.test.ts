/**
 * Tests for error classes.
 */

import { describe, it, expect } from "vitest";
import {
  SuperserveError,
  SuperserveAPIError,
  AuthenticationError,
  RunFailedError,
  RunCancelledError,
  NotFoundError,
  ConflictError,
  ValidationError,
  StreamAbortedError,
} from "../src/index.js";

describe("SuperserveError", () => {
  it("should be an instance of Error", () => {
    const error = new SuperserveError("Test error");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SuperserveError);
  });

  it("should set message correctly", () => {
    const error = new SuperserveError("Test message");

    expect(error.message).toBe("Test message");
  });

  it("should set name to SuperserveError", () => {
    const error = new SuperserveError("Test");

    expect(error.name).toBe("SuperserveError");
  });

  it("should have stack trace", () => {
    const error = new SuperserveError("Test");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("SuperserveError");
  });
});

describe("SuperserveAPIError", () => {
  it("should extend SuperserveError", () => {
    const error = new SuperserveAPIError("API error", 500);

    expect(error).toBeInstanceOf(SuperserveError);
    expect(error).toBeInstanceOf(SuperserveAPIError);
  });

  it("should set status code", () => {
    const error = new SuperserveAPIError("Not found", 404);

    expect(error.status).toBe(404);
  });

  it("should set error code", () => {
    const error = new SuperserveAPIError("Error", 400, "invalid_request");

    expect(error.code).toBe("invalid_request");
  });

  it("should set details", () => {
    const details = { field: "name", reason: "required" };
    const error = new SuperserveAPIError("Validation", 422, "validation_error", details);

    expect(error.details).toEqual(details);
  });

  it("should set name to SuperserveAPIError", () => {
    const error = new SuperserveAPIError("Error", 500);

    expect(error.name).toBe("SuperserveAPIError");
  });

  describe("fromResponse", () => {
    it("should create error from response with detail field", async () => {
      const response = new Response(
        JSON.stringify({ detail: "Resource not found" }),
        { status: 404 }
      );

      const error = await SuperserveAPIError.fromResponse(response);

      expect(error.message).toBe("Resource not found");
      expect(error.status).toBe(404);
    });

    it("should create error from response with message field", async () => {
      const response = new Response(
        JSON.stringify({ message: "Server error" }),
        { status: 500 }
      );

      const error = await SuperserveAPIError.fromResponse(response);

      expect(error.message).toBe("Server error");
    });

    it("should extract error code from response", async () => {
      const response = new Response(
        JSON.stringify({ detail: "Error", code: "rate_limit" }),
        { status: 429 }
      );

      const error = await SuperserveAPIError.fromResponse(response);

      expect(error.code).toBe("rate_limit");
    });

    it("should store full response body as details", async () => {
      const body = { detail: "Error", code: "test", extra: "data" };
      const response = new Response(JSON.stringify(body), { status: 400 });

      const error = await SuperserveAPIError.fromResponse(response);

      expect(error.details).toEqual(body);
    });

    it("should handle non-JSON response", async () => {
      const response = new Response("Internal Server Error", { status: 500 });

      const error = await SuperserveAPIError.fromResponse(response);

      expect(error.message).toBe("API request failed with status 500");
      expect(error.status).toBe(500);
    });

    it("should handle empty response body", async () => {
      const response = new Response(null, { status: 204 });

      const error = await SuperserveAPIError.fromResponse(response);

      expect(error.message).toBe("API request failed with status 204");
    });
  });
});

describe("AuthenticationError", () => {
  it("should extend SuperserveAPIError", () => {
    const error = new AuthenticationError();

    expect(error).toBeInstanceOf(SuperserveAPIError);
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  it("should have default message", () => {
    const error = new AuthenticationError();

    expect(error.message).toBe("Authentication failed");
  });

  it("should accept custom message", () => {
    const error = new AuthenticationError("Invalid API key");

    expect(error.message).toBe("Invalid API key");
  });

  it("should set status to 401", () => {
    const error = new AuthenticationError();

    expect(error.status).toBe(401);
  });

  it("should set code to authentication_error", () => {
    const error = new AuthenticationError();

    expect(error.code).toBe("authentication_error");
  });

  it("should set name to AuthenticationError", () => {
    const error = new AuthenticationError();

    expect(error.name).toBe("AuthenticationError");
  });

  describe("fromResponse", () => {
    it("should create error from 401 response", async () => {
      const response = new Response(
        JSON.stringify({ detail: "Invalid API key" }),
        { status: 401 }
      );

      const error = await AuthenticationError.fromResponse(response);

      expect(error.message).toBe("Invalid API key");
      expect(error).toBeInstanceOf(AuthenticationError);
    });

    it("should use default message for non-JSON response", async () => {
      const response = new Response("Unauthorized", { status: 401 });

      const error = await AuthenticationError.fromResponse(response);

      expect(error.message).toBe("Authentication failed");
    });
  });
});

describe("RunFailedError", () => {
  it("should extend SuperserveError", () => {
    const error = new RunFailedError("Failed", "run_123");

    expect(error).toBeInstanceOf(SuperserveError);
    expect(error).toBeInstanceOf(RunFailedError);
  });

  it("should set message", () => {
    const error = new RunFailedError("Execution timeout", "run_123");

    expect(error.message).toBe("Execution timeout");
  });

  it("should set runId", () => {
    const error = new RunFailedError("Error", "run_abc123");

    expect(error.runId).toBe("run_abc123");
  });

  it("should set error code", () => {
    const error = new RunFailedError("Timeout", "run_123", "timeout");

    expect(error.code).toBe("timeout");
  });

  it("should set name to RunFailedError", () => {
    const error = new RunFailedError("Error", "run_123");

    expect(error.name).toBe("RunFailedError");
  });

  it("should allow undefined code", () => {
    const error = new RunFailedError("Error", "run_123");

    expect(error.code).toBeUndefined();
  });
});

describe("RunCancelledError", () => {
  it("should extend SuperserveError", () => {
    const error = new RunCancelledError("run_123");

    expect(error).toBeInstanceOf(SuperserveError);
    expect(error).toBeInstanceOf(RunCancelledError);
  });

  it("should set message with run ID", () => {
    const error = new RunCancelledError("run_abc123");

    expect(error.message).toBe("Run run_abc123 was cancelled");
  });

  it("should set runId", () => {
    const error = new RunCancelledError("run_xyz");

    expect(error.runId).toBe("run_xyz");
  });

  it("should set name to RunCancelledError", () => {
    const error = new RunCancelledError("run_123");

    expect(error.name).toBe("RunCancelledError");
  });
});

describe("NotFoundError", () => {
  it("should extend SuperserveAPIError", () => {
    const error = new NotFoundError();

    expect(error).toBeInstanceOf(SuperserveAPIError);
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("should have default message", () => {
    const error = new NotFoundError();

    expect(error.message).toBe("Resource not found");
  });

  it("should accept custom message", () => {
    const error = new NotFoundError("Agent not found");

    expect(error.message).toBe("Agent not found");
  });

  it("should set status to 404", () => {
    const error = new NotFoundError();

    expect(error.status).toBe(404);
  });

  it("should set code to not_found", () => {
    const error = new NotFoundError();

    expect(error.code).toBe("not_found");
  });

  it("should set name to NotFoundError", () => {
    const error = new NotFoundError();

    expect(error.name).toBe("NotFoundError");
  });
});

describe("ConflictError", () => {
  it("should extend SuperserveAPIError", () => {
    const error = new ConflictError();

    expect(error).toBeInstanceOf(SuperserveAPIError);
    expect(error).toBeInstanceOf(ConflictError);
  });

  it("should have default message", () => {
    const error = new ConflictError();

    expect(error.message).toBe("Resource conflict");
  });

  it("should accept custom message", () => {
    const error = new ConflictError("Agent name already exists");

    expect(error.message).toBe("Agent name already exists");
  });

  it("should set status to 409", () => {
    const error = new ConflictError();

    expect(error.status).toBe(409);
  });

  it("should set code to conflict", () => {
    const error = new ConflictError();

    expect(error.code).toBe("conflict");
  });

  it("should set name to ConflictError", () => {
    const error = new ConflictError();

    expect(error.name).toBe("ConflictError");
  });
});

describe("ValidationError", () => {
  it("should extend SuperserveAPIError", () => {
    const error = new ValidationError();

    expect(error).toBeInstanceOf(SuperserveAPIError);
    expect(error).toBeInstanceOf(ValidationError);
  });

  it("should have default message", () => {
    const error = new ValidationError();

    expect(error.message).toBe("Validation failed");
  });

  it("should accept custom message", () => {
    const error = new ValidationError("Invalid agent name");

    expect(error.message).toBe("Invalid agent name");
  });

  it("should set status to 422", () => {
    const error = new ValidationError();

    expect(error.status).toBe(422);
  });

  it("should set code to validation_error", () => {
    const error = new ValidationError();

    expect(error.code).toBe("validation_error");
  });

  it("should accept details", () => {
    const details = { field: "name", errors: ["too short", "invalid chars"] };
    const error = new ValidationError("Validation failed", details);

    expect(error.details).toEqual(details);
  });

  it("should set name to ValidationError", () => {
    const error = new ValidationError();

    expect(error.name).toBe("ValidationError");
  });
});

describe("StreamAbortedError", () => {
  it("should extend SuperserveError", () => {
    const error = new StreamAbortedError();

    expect(error).toBeInstanceOf(SuperserveError);
    expect(error).toBeInstanceOf(StreamAbortedError);
  });

  it("should have default message", () => {
    const error = new StreamAbortedError();

    expect(error.message).toBe("Stream was aborted");
  });

  it("should accept custom message", () => {
    const error = new StreamAbortedError("Connection lost");

    expect(error.message).toBe("Connection lost");
  });

  it("should set name to StreamAbortedError", () => {
    const error = new StreamAbortedError();

    expect(error.name).toBe("StreamAbortedError");
  });
});

describe("error hierarchy", () => {
  it("should allow catching all SDK errors with SuperserveError", () => {
    const errors = [
      new SuperserveError("Base"),
      new SuperserveAPIError("API", 500),
      new AuthenticationError(),
      new NotFoundError(),
      new ConflictError(),
      new ValidationError(),
      new RunFailedError("Failed", "run_1"),
      new RunCancelledError("run_1"),
      new StreamAbortedError(),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(SuperserveError);
    }
  });

  it("should allow catching API errors with SuperserveAPIError", () => {
    const apiErrors = [
      new SuperserveAPIError("API", 500),
      new AuthenticationError(),
      new NotFoundError(),
      new ConflictError(),
      new ValidationError(),
    ];

    for (const error of apiErrors) {
      expect(error).toBeInstanceOf(SuperserveAPIError);
    }
  });

  it("should distinguish between run errors", () => {
    const failedError = new RunFailedError("Failed", "run_1");
    const cancelledError = new RunCancelledError("run_1");

    expect(failedError).not.toBeInstanceOf(RunCancelledError);
    expect(cancelledError).not.toBeInstanceOf(RunFailedError);
  });
});
