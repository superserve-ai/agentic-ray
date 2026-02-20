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
