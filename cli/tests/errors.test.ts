import { describe, expect, test } from "bun:test"
import { PlatformAPIError } from "../src/api/errors"
import { handleError } from "../src/errors"

describe("handleError", () => {
  test("PlatformAPIError returns exit code 1", () => {
    const originalError = console.error
    console.error = () => {}
    try {
      const code = handleError(new PlatformAPIError(404, "Not found"))
      expect(code).toBe(1)
    } finally {
      console.error = originalError
    }
  })

  test("PlatformAPIError 401 returns exit code 1", () => {
    const originalError = console.error
    console.error = () => {}
    try {
      const code = handleError(new PlatformAPIError(401, "Unauthorized"))
      expect(code).toBe(1)
    } finally {
      console.error = originalError
    }
  })

  test("AbortError returns exit code 130", () => {
    const originalError = console.error
    console.error = () => {}
    try {
      const err = new Error("SIGINT")
      err.name = "AbortError"
      const code = handleError(err)
      expect(code).toBe(130)
    } finally {
      console.error = originalError
    }
  })

  test("SIGINT message returns exit code 130", () => {
    const originalError = console.error
    console.error = () => {}
    try {
      const code = handleError(new Error("SIGINT"))
      expect(code).toBe(130)
    } finally {
      console.error = originalError
    }
  })

  test("generic Error returns exit code 1", () => {
    const originalError = console.error
    console.error = () => {}
    try {
      const code = handleError(new Error("Something went wrong"))
      expect(code).toBe(1)
    } finally {
      console.error = originalError
    }
  })

  test("non-Error returns exit code 1", () => {
    const code = handleError("string error")
    expect(code).toBe(1)
  })
})
