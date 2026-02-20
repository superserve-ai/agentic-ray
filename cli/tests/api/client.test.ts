import { describe, expect, test } from "bun:test"
import { PlatformAPIError } from "../../src/api/errors"

describe("PlatformAPIError", () => {
  test("creates error with status code and message", () => {
    const error = new PlatformAPIError(404, "Not found")
    expect(error.statusCode).toBe(404)
    expect(error.message).toBe("Not found")
    expect(error.details).toEqual({})
  })

  test("creates error with details", () => {
    const error = new PlatformAPIError(400, "Bad request", {
      oauth_error: "authorization_pending",
    })
    expect(error.details.oauth_error).toBe("authorization_pending")
  })

  test("toString includes message", () => {
    const error = new PlatformAPIError(500, "Server error")
    expect(String(error)).toContain("Server error")
    expect(error.statusCode).toBe(500)
  })
})

describe("ERROR_HINTS", () => {
  test("has hints for common status codes", async () => {
    const { ERROR_HINTS } = await import("../../src/api/errors")
    expect(ERROR_HINTS[401]).toBeTruthy()
    expect(ERROR_HINTS[403]).toBeTruthy()
    expect(ERROR_HINTS[404]).toBeTruthy()
    expect(ERROR_HINTS[429]).toBeTruthy()
    expect(ERROR_HINTS[500]).toBeTruthy()
  })
})
