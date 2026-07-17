import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useQueryScope } from "@/components/query-provider"
import { listActivityPaged } from "@/lib/api/activity"
import { auditLogKeys } from "@/lib/api/query-keys"
import type { ActivityListParams } from "@/lib/api/types"

export function useActivityPage(
  params: ActivityListParams,
  options: { enabled?: boolean } = {},
) {
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: [...auditLogKeys.list(params), queryScope],
    queryFn: () => listActivityPaged(params),
    enabled: options.enabled,
    // Keep the current page on screen while the next page/filter loads so
    // navigation doesn't flash an empty table.
    placeholderData: keepPreviousData,
  })
}
