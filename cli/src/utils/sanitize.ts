// Regex pattern to match ANSI escape sequences
// Covers CSI sequences (most common), OSC sequences, and other control sequences
const ANSI_ESCAPE_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: need to match ANSI escape sequences
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\].*?(?:\x07|\x1b\\)|[PX^_].*?\x1b\\|[NO].|[()*/+].|[=>]|c)/g

export function sanitizeTerminalOutput(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "")
}
