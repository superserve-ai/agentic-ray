function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) => {
        if (key === "access_token") return []
        return [[key, redactValue(entry)]]
      }),
    )
  }

  return value
}

export function redactAccessTokens(rawJson: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(rawJson)))
  } catch {
    return rawJson
  }
}
