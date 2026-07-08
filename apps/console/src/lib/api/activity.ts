import { apiClientList, type PagedResult } from "./client"
import type { ActivityListParams, ActivityResponse } from "./types"

/** Serializes ActivityListParams into the GET /activity query string. */
export function activityListQuery(params: ActivityListParams): string {
  const q = new URLSearchParams()
  q.set("limit", String(params.pageSize))
  q.set("offset", String((params.page - 1) * params.pageSize))
  q.set("sort", params.sort)
  q.set("order", params.order)
  if (params.category) q.set("category", params.category)
  if (params.status) q.set("status", params.status)
  if (params.q) q.set("q", params.q)
  if (params.start) q.set("start", params.start)
  if (params.end) q.set("end", params.end)
  return q.toString()
}

export async function listActivityPaged(
  params: ActivityListParams,
): Promise<PagedResult<ActivityResponse>> {
  return apiClientList<ActivityResponse>(
    `/activity?${activityListQuery(params)}`,
  )
}
