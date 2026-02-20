import pc from "picocolors"

const { dim, green, red, yellow } = pc

const SESSION_STATUS_COLORS: Record<string, (t: string) => string> = {
  active: green,
  running: green,
  completed: dim,
  ended: dim,
  failed: red,
  error: red,
  pending: yellow,
}

export function coloredSessionStatus(status: string): string {
  const colorize = SESSION_STATUS_COLORS[status]
  return colorize ? colorize(status) : status
}
