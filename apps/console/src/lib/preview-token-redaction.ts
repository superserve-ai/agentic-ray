import type { CapturedNetworkRequest } from "posthog-js"

// The API owns the query-parameter name. Keep the analytics scrubber in sync
// with the credential response instead of duplicating the backend constant in
// the console bundle. The PostHog callback reads this set dynamically, so a
// name registered after initialization is still scrubbed before capture.
const previewTokenQueryParams = new Set<string>()

export function registerPreviewTokenQueryParam(queryParam: string): void {
  if (queryParam) previewTokenQueryParams.add(queryParam)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function redactPreviewToken(
  request: CapturedNetworkRequest,
): CapturedNetworkRequest {
  if (
    ![...previewTokenQueryParams].some((queryParam) =>
      request.name.includes(queryParam),
    )
  ) {
    return request
  }

  try {
    const url = new URL(request.name)
    let changed = false
    for (const queryParam of previewTokenQueryParams) {
      if (!url.searchParams.has(queryParam)) continue
      url.searchParams.set(queryParam, "redacted")
      changed = true
    }
    return changed ? { ...request, name: url.toString() } : request
  } catch {
    let name = request.name
    for (const queryParam of previewTokenQueryParams) {
      name = name.replace(
        new RegExp(`([?&]${escapeRegExp(queryParam)}=)[^&#]*`, "g"),
        "$1redacted",
      )
    }
    return name === request.name ? request : { ...request, name }
  }
}
