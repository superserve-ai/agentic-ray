export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatTime(date: Date): { relative: string; absolute: string } {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  let relative: string
  if (diffMin < 1) relative = "Just now"
  else if (diffMin < 60) relative = `${diffMin}m ago`
  else if (diffHr < 24) relative = `${diffHr}h ago`
  else if (diffDays < 7) relative = `${diffDays}d ago`
  else
    relative = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })

  const absolute = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  return { relative, absolute }
}

const REGION_LABELS: Record<string, string> = {
  use: "US East",
  usw: "US West",
}

/** Human label for a cell region code; unknown codes pass through as-is. */
export function regionLabel(region: string): string {
  return REGION_LABELS[region] ?? region
}

/** Compact duration label (s/m/h/d) for timeout and auto-delete windows. */
export function formatTimeout(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}
