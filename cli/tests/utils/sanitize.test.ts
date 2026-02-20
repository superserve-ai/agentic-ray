import { describe, expect, test } from "bun:test"
import { sanitizeTerminalOutput } from "../../src/utils/sanitize"

describe("sanitizeTerminalOutput", () => {
  test("returns plain text unchanged", () => {
    expect(sanitizeTerminalOutput("hello world")).toBe("hello world")
  })

  test("strips CSI sequences (colors)", () => {
    expect(sanitizeTerminalOutput("\x1b[31mred text\x1b[0m")).toBe("red text")
    expect(sanitizeTerminalOutput("\x1b[1;32mgreen bold\x1b[0m")).toBe(
      "green bold",
    )
  })

  test("strips cursor movement sequences", () => {
    expect(sanitizeTerminalOutput("\x1b[2Ahello")).toBe("hello")
    expect(sanitizeTerminalOutput("\x1b[10Cworld")).toBe("world")
  })

  test("strips OSC sequences", () => {
    expect(sanitizeTerminalOutput("\x1b]0;title\x07text")).toBe("text")
  })

  test("strips RIS (reset) sequences", () => {
    expect(sanitizeTerminalOutput("\x1bctext")).toBe("text")
  })

  test("handles empty string", () => {
    expect(sanitizeTerminalOutput("")).toBe("")
  })

  test("handles multiple sequences", () => {
    expect(
      sanitizeTerminalOutput("\x1b[31m\x1b[1mred bold\x1b[0m normal"),
    ).toBe("red bold normal")
  })
})
