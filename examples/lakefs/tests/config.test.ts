import { describe, expect, it } from "vitest"

import {
  positiveInteger,
  requiredDownloadUrl,
  requiredEndpoint,
  requiredEnv,
  requiredIdentifier,
  requiredSha256,
  shellQuote,
} from "../src/config"

const SHA = "a".repeat(64)

describe("requiredEnv", () => {
  it("trims the value", () => {
    expect(requiredEnv("X", { X: "  value  " })).toBe("value")
  })

  it.each([
    ["missing", {}],
    ["empty", { X: "" }],
    ["whitespace only", { X: "   " }],
  ])("rejects %s", (_label, env) => {
    expect(() => requiredEnv("X", env)).toThrow(/X is required/)
  })
})

describe("requiredDownloadUrl", () => {
  // The reason this validator exists separately from requiredEndpoint: lakeFS
  // hands out presigned URLs, and rejecting their query strings would fail
  // the documented input at startup.
  it("accepts a presigned URL with a query string", () => {
    const presigned =
      "https://lakefs-artifacts.s3.amazonaws.com/everest/everest_linux_amd64.tar.gz" +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAEXAMPLE%2F20260805%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20260805T000000Z&X-Amz-Expires=3600" +
      "&X-Amz-SignedHeaders=host&X-Amz-Signature=abc123"
    expect(requiredDownloadUrl("U", { U: presigned })).toBe(presigned)
  })

  it("accepts a plain URL with no query", () => {
    const url = "https://example.com/everest.tar.gz"
    expect(requiredDownloadUrl("U", { U: url })).toBe(url)
  })

  it.each([
    ["a single quote", "https://example.com/e.tar.gz?sig=a'b"],
    ["a backtick", "https://example.com/e.tar.gz?sig=`id`"],
    ["a double quote", 'https://example.com/e.tar.gz?sig="x"'],
    ["a backslash", "https://example.com/e.tar.gz?sig=a\\b"],
    ["a newline", "https://example.com/e.tar.gz?sig=a\nrm -rf /"],
    ["a space", "https://example.com/e.tar.gz?sig=a b"],
  ])("rejects %s, which shell quoting could not contain", (_label, value) => {
    expect(() => requiredDownloadUrl("U", { U: value })).toThrow(/U must match/)
  })

  it.each([
    ["http", "http://example.com/e.tar.gz", /must use https/],
    ["credentials", "https://user:pw@example.com/e.tar.gz", /credentials/],
    ["a fragment", "https://example.com/e.tar.gz#frag", /fragment/],
    ["a non-URL", "not-a-url", /must be a valid URL/],
  ])("rejects %s", (_label, value, message) => {
    expect(() => requiredDownloadUrl("U", { U: value })).toThrow(message)
  })

  it("survives shell quoting: metacharacters stay inside the quotes", () => {
    // `&` and `=` are legal in a presigned URL and would otherwise background
    // the curl command. Quoting is what makes admitting them safe.
    const url = "https://example.com/e.tar.gz?a=1&b=2"
    const quoted = shellQuote(requiredDownloadUrl("U", { U: url }))
    expect(quoted).toBe("'https://example.com/e.tar.gz?a=1&b=2'")
  })
})

describe("requiredEndpoint", () => {
  it("strips trailing slashes", () => {
    expect(requiredEndpoint("E", { E: "https://lakefs.example.com//" })).toBe(
      "https://lakefs.example.com",
    )
  })

  it("allows http for a self-hosted deployment", () => {
    expect(requiredEndpoint("E", { E: "http://localhost:8000" })).toBe(
      "http://localhost:8000",
    )
  })

  it.each([
    ["a query", "https://lakefs.example.com?x=1"],
    ["a fragment", "https://lakefs.example.com#x"],
    ["credentials", "https://user:pw@lakefs.example.com"],
  ])("rejects an API base URL with %s", (_label, value) => {
    expect(() => requiredEndpoint("E", { E: value })).toThrow(
      /must not contain credentials, a query, or a fragment/,
    )
  })

  it("rejects a non-http protocol", () => {
    expect(() => requiredEndpoint("E", { E: "ftp://example.com" })).toThrow(
      /must use http or https/,
    )
  })
})

describe("requiredIdentifier", () => {
  it("accepts dots, dashes, and underscores", () => {
    expect(requiredIdentifier("R", { R: "my-repo_1.0" })).toBe("my-repo_1.0")
  })

  it.each([
    ["a slash", "repo/../other"],
    ["a command substitution", "repo$(id)"],
    ["a semicolon", "repo;reboot"],
    ["a space", "my repo"],
  ])("rejects %s", (_label, value) => {
    expect(() => requiredIdentifier("R", { R: value })).toThrow(/R must match/)
  })
})

describe("requiredSha256", () => {
  it("accepts 64 lowercase hex digits", () => {
    expect(requiredSha256("S", { S: SHA })).toBe(SHA)
  })

  it.each([
    ["uppercase", "A".repeat(64)],
    ["too short", "a".repeat(63)],
    ["too long", "a".repeat(65)],
    ["non-hex", `${"a".repeat(63)}z`],
  ])("rejects %s", (_label, value) => {
    expect(() => requiredSha256("S", { S: value })).toThrow(/S must match/)
  })
})

describe("positiveInteger", () => {
  it("falls back when unset", () => {
    expect(positiveInteger("N", 2, {})).toBe(2)
  })

  it("parses a value in range", () => {
    expect(positiveInteger("N", 2, { N: "5" })).toBe(5)
  })

  it.each([["0"], ["17"], ["-1"], ["1.5"], ["abc"]])(
    "rejects %s",
    (value: string) => {
      expect(() => positiveInteger("N", 2, { N: value })).toThrow(
        /N must be an integer between 1 and 16/,
      )
    },
  )
})

describe("shellQuote", () => {
  it("neutralizes an embedded single quote", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })

  it("leaves expansions literal", () => {
    expect(shellQuote("$(id) `id` $HOME")).toBe("'$(id) `id` $HOME'")
  })
})
