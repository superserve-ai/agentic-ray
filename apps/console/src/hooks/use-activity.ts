import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { listActivityPaged } from "@/lib/api/activity"
import { auditLogKeys } from "@/lib/api/query-keys"
import type { ActivityListParams } from "@/lib/api/types"

export function useActivityPage(params: ActivityListParams) {
  return useQuery({
    queryKey: auditLogKeys.list(params),
    queryFn: () => listActivityPaged(params),
    // Keep the current page on screen while the next page/filter loads so
    // navigation doesn't flash an empty table.
    placeholderData: keepPreviousData,
  })
}
