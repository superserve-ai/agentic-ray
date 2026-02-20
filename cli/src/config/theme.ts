const useColor = !process.argv.includes("--no-color") && !process.env.NO_COLOR

export const ansi = {
  primary: useColor ? "\x1b[38;2;45;212;191m" : "",
  error: useColor ? "\x1b[31m" : "",
  warning: useColor ? "\x1b[33m" : "",
  success: useColor ? "\x1b[32m" : "",
  muted: useColor ? "\x1b[2m" : "",
  bold: useColor ? "\x1b[1m" : "",
  reset: useColor ? "\x1b[0m" : "",
} as const

export const spinnerConfig = {
  frames: "\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F",
  interval: 80,
} as const
