import { ERROR_HINTS, PlatformAPIError } from "./api/errors"
import { log } from "./utils/logger"

export function handleError(e: unknown): number {
  if (e instanceof PlatformAPIError) {
    log.error(e.message)
    const hint = ERROR_HINTS[e.statusCode]
    if (hint) log.hint(hint)
    return 1
  }

  if (
    e instanceof Error &&
    (e.name === "AbortError" || e.message === "SIGINT")
  ) {
    console.error()
    return 130
  }

  if (e instanceof Error) {
    log.error("An unexpected error occurred. Please try again.")
    return 1
  }

  log.error("An unexpected error occurred. Please try again.")
  return 1
}

// biome-ignore lint/suspicious/noExplicitAny: Commander passes variadic args
export function withErrorHandler<T extends (...args: any[]) => Promise<void>>(
  fn: T,
): T {
  // biome-ignore lint/suspicious/noExplicitAny: wraps Commander action callbacks
  const wrapped = async (...args: any[]) => {
    try {
      await fn(...args)
    } catch (e) {
      const code = handleError(e)
      process.exit(code)
    }
  }
  return wrapped as T
}
