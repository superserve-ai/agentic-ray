export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

/** A page of list results plus the total row count across all pages. */
export interface PagedResult<T> {
  items: T[]
  total: number
}

function getBaseUrl(): string {
  return "/api"
}

/**
 * Runs a request against the console API proxy with a 30s timeout and unified
 * error handling, then hands the successful Response to `read`. The reader runs
 * inside the timeout window so a slow body read still aborts.
 */
async function request<R>(
  path: string,
  options: RequestInit,
  read: (response: Response) => Promise<R>,
): Promise<R> {
  const url = `${getBaseUrl()}${path}`

  const headers = new Headers(options.headers)
  if (
    !headers.has("Content-Type") &&
    options.body &&
    typeof options.body === "string"
  ) {
    headers.set("Content-Type", "application/json")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      let code = "unknown_error"
      let message = response.statusText

      try {
        const body = await response.json()
        if (body?.error?.code) code = body.error.code
        if (body?.error?.message) message = body.error.message
      } catch {
        // response body is not JSON, use defaults
      }

      throw new ApiError(response.status, code, message)
    }

    return await read(response)
  } finally {
    clearTimeout(timeout)
  }
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return request(path, options, async (response) => {
    if (response.status === 204) {
      return undefined as T
    }
    return response.json() as Promise<T>
  })
}

/**
 * Like `apiClient`, but for list endpoints: returns the parsed array plus the
 * total row count from the `X-Total-Count` header. Falls back to the page
 * length when the header is absent (e.g. an older API build without
 * pagination), so callers always get a usable `total`.
 */
export async function apiClientList<T>(
  path: string,
  options: RequestInit = {},
): Promise<PagedResult<T>> {
  return request(path, options, async (response) => {
    const items = (await response.json()) as T[]
    const header = response.headers.get("X-Total-Count")
    const parsed = header != null ? Number(header) : Number.NaN
    return {
      items,
      total: Number.isFinite(parsed) ? parsed : items.length,
    }
  })
}
