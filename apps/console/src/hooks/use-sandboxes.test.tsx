/**
 * use-sandboxes hook tests — focus on optimistic updates, rollback, and
 * cache invalidation. Mocks the `@/lib/api/sandboxes` layer so tests don't
 * hit the real fetch. List results are cached per-page as `{ items, total }`
 * under sandboxKeys.list(params); the mutations patch every such cache via
 * sandboxKeys.lists(), so seeding one representative page is enough.
 */

import type { QueryClient } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, type PagedResult } from "@/lib/api/client"
import { sandboxKeys } from "@/lib/api/query-keys"
import type { SandboxListParams, SandboxResponse } from "@/lib/api/types"
import { createQueryWrapper } from "@/test/react-query"

// Mock the API layer. These functions are what the hooks delegate to.
const mockCreate = vi.fn()
const mockDelete = vi.fn()
const mockPause = vi.fn()
const mockResume = vi.fn()

vi.mock("@/lib/api/sandboxes", () => ({
  createSandbox: (...a: unknown[]) => mockCreate(...a),
  deleteSandbox: (...a: unknown[]) => mockDelete(...a),
  pauseSandbox: (...a: unknown[]) => mockPause(...a),
  resumeSandbox: (...a: unknown[]) => mockResume(...a),
  listSandboxesPaged: vi.fn(),
  getSandbox: vi.fn(),
  patchSandbox: vi.fn(),
}))

// Silent toast — return a spy so tests can inspect calls.
const mockAddToast = vi.fn()
vi.mock("@superserve/ui", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}))

import {
  useBulkDeleteSandboxes,
  useCreateSandbox,
  useDeleteSandbox,
  usePauseSandbox,
  useResumeSandbox,
} from "./use-sandboxes"

const sandbox = (
  overrides: Partial<SandboxResponse> = {},
): SandboxResponse => ({
  id: "sbx-1",
  name: "test",
  status: "active",
  vcpu_count: 1,
  memory_mib: 512,
  access_token: "tok",
  metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

// A representative page-cache key + shape. The mutations target every cache
// under sandboxKeys.lists(), so this single seeded page stands in for the
// user's current view.
const LIST_PARAMS: SandboxListParams = {
  page: 1,
  pageSize: 50,
  sort: "created_at",
  order: "desc",
}
const listKey = sandboxKeys.list(LIST_PARAMS)
const page = (items: SandboxResponse[]): PagedResult<SandboxResponse> => ({
  items,
  total: items.length,
})
const cachedList = (
  queryClient: QueryClient,
): PagedResult<SandboxResponse> | undefined =>
  queryClient.getQueryData<PagedResult<SandboxResponse>>(listKey)

describe("useCreateSandbox", () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockAddToast.mockReset()
  })

  it("shows a success toast on success", async () => {
    const { wrapper } = createQueryWrapper()
    mockCreate.mockResolvedValue(sandbox({ id: "new", name: "new-box" }))

    const { result } = renderHook(() => useCreateSandbox(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: "new-box" })
    })

    expect(mockAddToast).toHaveBeenCalledWith(
      'Sandbox "new-box" created',
      "success",
    )
  })

  it("shows an error toast with ApiError message on failure", async () => {
    const { wrapper } = createQueryWrapper()
    mockCreate.mockRejectedValue(
      new ApiError(429, "quota_exceeded", "Quota exceeded"),
    )

    const { result } = renderHook(() => useCreateSandbox(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: "x" }).catch(() => {})
    })

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith("Quota exceeded", "error")
    })
  })

  it("falls back to a generic message on non-ApiError failures", async () => {
    const { wrapper } = createQueryWrapper()
    mockCreate.mockRejectedValue(new Error("network"))

    const { result } = renderHook(() => useCreateSandbox(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: "x" }).catch(() => {})
    })

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create sandbox"),
        "error",
      )
    })
  })
})

describe("useDeleteSandbox", () => {
  beforeEach(() => {
    mockDelete.mockReset()
    mockAddToast.mockReset()
  })

  it("optimistically removes the sandbox from the page cache", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(
      listKey,
      page([sandbox({ id: "a" }), sandbox({ id: "b" })]),
    )
    mockDelete.mockResolvedValue(undefined)

    const { result } = renderHook(() => useDeleteSandbox(), { wrapper })

    act(() => {
      result.current.mutate("a")
    })

    // Immediately after mutate, the optimistic removal should apply.
    await waitFor(() => {
      expect(cachedList(queryClient)?.items.map((s) => s.id)).toEqual(["b"])
    })
  })

  it("rolls back the cache on failure", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    const before = page([sandbox({ id: "a" }), sandbox({ id: "b" })])
    queryClient.setQueryData(listKey, before)
    mockDelete.mockRejectedValue(new Error("boom"))

    const { result } = renderHook(() => useDeleteSandbox(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync("a").catch(() => {})
    })

    await waitFor(() => {
      // Cache restored to the pre-mutate snapshot.
      expect(cachedList(queryClient)).toEqual(before)
    })
    expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), "error")
  })
})

describe("useBulkDeleteSandboxes", () => {
  beforeEach(() => {
    mockDelete.mockReset()
    mockAddToast.mockReset()
  })

  it("optimistically removes all selected sandboxes", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(
      listKey,
      page([sandbox({ id: "a" }), sandbox({ id: "b" }), sandbox({ id: "c" })]),
    )
    mockDelete.mockResolvedValue(undefined)

    const { result } = renderHook(() => useBulkDeleteSandboxes(), {
      wrapper,
    })

    await act(async () => {
      await result.current.mutateAsync(["a", "c"])
    })

    expect(cachedList(queryClient)?.items.map((s) => s.id)).toEqual(["b"])
    expect(mockDelete).toHaveBeenCalledTimes(2)
  })
})

describe("usePauseSandbox / useResumeSandbox", () => {
  beforeEach(() => {
    mockPause.mockReset()
    mockResume.mockReset()
    mockAddToast.mockReset()
  })

  it("pauses: flips the cached sandbox to paused optimistically", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(
      listKey,
      page([sandbox({ id: "a", status: "active" })]),
    )
    mockPause.mockResolvedValue(undefined)

    const { result } = renderHook(() => usePauseSandbox(), { wrapper })
    act(() => {
      result.current.mutate("a")
    })

    await waitFor(() => {
      expect(cachedList(queryClient)?.items[0].status).toBe("paused")
    })
  })

  it("resumes: flips the cached sandbox to resuming optimistically, then active on success with the fresh access_token", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(
      listKey,
      page([sandbox({ id: "a", status: "paused" })]),
    )
    queryClient.setQueryData(
      sandboxKeys.detail("a"),
      sandbox({ id: "a", status: "paused", access_token: "old" }),
    )
    // Resolve slowly so the optimistic "resuming" state is observable before
    // the success handler lands.
    let resolveResume: (value: {
      id: string
      status: "active"
      access_token: string
    }) => void = () => {}
    mockResume.mockImplementation(
      () =>
        new Promise((r) => {
          resolveResume = r
        }),
    )

    const { result } = renderHook(() => useResumeSandbox(), { wrapper })
    act(() => {
      result.current.mutate("a")
    })

    await waitFor(() => {
      expect(cachedList(queryClient)?.items[0].status).toBe("resuming")
      const detail = queryClient.getQueryData<SandboxResponse>(
        sandboxKeys.detail("a"),
      )
      expect(detail?.status).toBe("resuming")
    })

    await act(async () => {
      resolveResume({ id: "a", status: "active", access_token: "fresh" })
    })

    await waitFor(() => {
      const detail = queryClient.getQueryData<SandboxResponse>(
        sandboxKeys.detail("a"),
      )
      expect(detail?.status).toBe("active")
      expect(detail?.access_token).toBe("fresh")
    })
  })

  it("rolls back pause on error", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    const before = page([sandbox({ id: "a", status: "active" })])
    queryClient.setQueryData(listKey, before)
    mockPause.mockRejectedValue(new Error("boom"))

    const { result } = renderHook(() => usePauseSandbox(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync("a").catch(() => {})
    })

    await waitFor(() => {
      expect(cachedList(queryClient)).toEqual(before)
    })
  })
})

afterEach(() => {
  vi.clearAllMocks()
})
