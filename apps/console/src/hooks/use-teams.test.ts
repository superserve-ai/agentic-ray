import { describe, expect, it, vi } from "vitest"

import { billingKeys, teamKeys } from "@/lib/api/query-keys"

import { refreshTeamScopedQueries } from "./use-teams"

describe("refreshTeamScopedQueries", () => {
  it("invalidates billing and resets all non-team queries", () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      resetQueries: vi.fn(),
    }

    refreshTeamScopedQueries(queryClient as never)

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: billingKeys.all,
    })
    expect(queryClient.resetQueries).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    })
    const predicate = queryClient.resetQueries.mock.calls[0][0]
      .predicate as (query: { queryKey: readonly unknown[] }) => boolean
    expect(predicate({ queryKey: teamKeys.directory() })).toBe(false)
    expect(predicate({ queryKey: billingKeys.all })).toBe(true)
  })
})
