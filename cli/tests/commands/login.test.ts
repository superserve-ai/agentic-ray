import { describe, expect, test } from "bun:test"
import { PlatformAPIError } from "../../src/api/errors"

describe("login - auth flow logic", () => {
  test("PlatformAPIError with oauth_error for pending auth", () => {
    const error = new PlatformAPIError(428, "Authorization pending", {
      oauth_error: "authorization_pending",
    })
    expect(error.statusCode).toBe(428)
    expect(error.details.oauth_error).toBe("authorization_pending")
  })

  test("PlatformAPIError with oauth_error for slow_down", () => {
    const error = new PlatformAPIError(400, "Slow down", {
      oauth_error: "slow_down",
    })
    expect(error.details.oauth_error).toBe("slow_down")
  })

  test("PlatformAPIError with oauth_error for expired_token", () => {
    const error = new PlatformAPIError(410, "Device code expired", {
      oauth_error: "expired_token",
    })
    expect(error.statusCode).toBe(410)
    expect(error.details.oauth_error).toBe("expired_token")
  })

  test("PlatformAPIError with oauth_error for access_denied", () => {
    const error = new PlatformAPIError(403, "Access denied by user", {
      oauth_error: "access_denied",
    })
    expect(error.statusCode).toBe(403)
  })
})
