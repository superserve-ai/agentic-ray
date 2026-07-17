import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { auditLogKeys } from "@/lib/api/query-keys"
import type { ActivityListParams } from "@/lib/api/types"
import { createQueryWrapper } from "@/test/react-query"

const queryScope = vi.hoisted(() => ({ value: "self" }))
const listActivityPaged = vi.hoisted(() => vi.fn())

vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => queryScope.value,
}))

vi.mock("@/lib/api/activity", () => ({
  listActivityPaged: (...args: unknown[]) => listActivityPaged(...args),
}))

import { useActivityPage } from "./use-activity"

const params: ActivityListParams = {
  page: 1,
  pageSize: 50,
  sort: "created_at",
  order: "desc",
}

describe("useActivityPage", () => {
  beforeEach(() => {
    queryScope.value = "self"
    listActivityPaged.mockReset()
  })

  it("isolates cached activity by the current team scope", async () => {
    listActivityPaged
      .mockResolvedValueOnce({ items: [{ id: "self-log" }], total: 1 })
      .mockResolvedValueOnce({ items: [{ id: "team-log" }], total: 1 })
    const { queryClient, wrapper } = createQueryWrapper()
    const { result, rerender } = renderHook(() => useActivityPage(params), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryScope.value = "team-1"
    rerender()
    await waitFor(() => expect(listActivityPaged).toHaveBeenCalledTimes(2))

    expect(
      queryClient.getQueryData([...auditLogKeys.list(params), "self"]),
    ).toEqual({ items: [{ id: "self-log" }], total: 1 })
    expect(
      queryClient.getQueryData([...auditLogKeys.list(params), "team-1"]),
    ).toEqual({ items: [{ id: "team-log" }], total: 1 })
  })
})
