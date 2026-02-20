export class PlatformAPIError extends Error {
  statusCode: number
  details: Record<string, unknown>

  constructor(
    statusCode: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(`[${statusCode}] ${message}`)
    this.name = "PlatformAPIError"
    this.statusCode = statusCode
    this.message = message
    this.details = details ?? {}
  }
}

export const ERROR_HINTS: Record<number, string> = {
  401: "Run `superserve login` to authenticate.",
  403: "You don't have permission for this action.",
  404: "Run `superserve agents list` to see your agents.",
  409: "Use a different name or delete the existing resource first.",
  422: "Check your input and try again.",
  429: "Too many requests. Please wait and try again.",
  500: "This is a server issue. Please try again later.",
  502: "The server is temporarily unavailable. Please try again later.",
  503: "The service is temporarily unavailable. Please try again later.",
}

const USER_FRIENDLY_MESSAGES: Record<number, string> = {
  500: "Something went wrong on our end. Please try again later.",
  502: "We're experiencing some issues. Please try again after some time.",
  503: "Service is temporarily unavailable. Please try again after some time.",
  504: "The request timed out. Please try again after some time.",
}

const GENERIC_SERVER_ERROR =
  "We're experiencing some issues. Please try again after some time."

/**
 * Returns a user-friendly message for server errors (5xx).
 * For client errors (4xx), returns the original message since those are actionable.
 */
export function toUserMessage(statusCode: number, rawMessage: string): string {
  if (statusCode >= 500) {
    return USER_FRIENDLY_MESSAGES[statusCode] ?? GENERIC_SERVER_ERROR
  }
  return rawMessage
}
