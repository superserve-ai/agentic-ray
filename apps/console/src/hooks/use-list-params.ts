"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

import type { SortDirection } from "@/lib/api/types"

import { useDebouncedValue } from "./use-debounced-value"

const SEARCH_DEBOUNCE_MS = 300
// Mirrors the backend's maxPageSize so a hand-crafted ?size= can't desync the
// pager's math (page count / "X of Y") from the rows the API will actually
// return.
const MAX_PAGE_SIZE = 200

interface UseListParamsConfig {
  defaultSort: string
  defaultPageSize?: number
}

/**
 * Manages the shared URL state for a paginated list page: page, page size,
 * sort column + direction, and name search. Filter tabs (status, owner, …) are
 * page-specific and set through the returned `setParam` helper.
 *
 * The URL is the single source of truth, so pages are shareable and survive
 * refresh / back-forward. The search input and URL update on every keystroke;
 * only `debouncedQ` (fed to the query) lags, so typing doesn't fire a request
 * per character. Any filter/sort/search change resets back to page 1.
 */
export function useListParams({
  defaultSort,
  defaultPageSize = 50,
}: UseListParamsConfig) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("size")) || defaultPageSize),
  )
  const sort = searchParams.get("sort") ?? defaultSort
  const order: SortDirection =
    searchParams.get("order") === "asc" ? "asc" : "desc"
  const q = searchParams.get("q") ?? ""
  const debouncedQ = useDebouncedValue(q, SEARCH_DEBOUNCE_MS)

  const setParam = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key)
        else next.set(key, value)
      }
      // Any filter/sort/search change sends the user back to page 1, unless the
      // caller is explicitly navigating pages.
      if (resetPage && !("page" in patch)) next.delete("page")
      const qs = next.toString()
      router.replace(qs ? `?${qs}` : window.location.pathname)
    },
    [router, searchParams],
  )

  const setSearch = useCallback(
    (value: string) => setParam({ q: value || null }),
    [setParam],
  )

  const toggleSort = useCallback(
    (column: string) => {
      if (sort === column) {
        setParam({ order: order === "asc" ? "desc" : "asc" })
      } else {
        setParam({ sort: column, order: "asc" })
      }
    },
    [sort, order, setParam],
  )

  const setPage = useCallback(
    (next: number) => setParam({ page: String(next) }, false),
    [setParam],
  )

  const setPageSize = useCallback(
    (next: number) => setParam({ size: String(next) }),
    [setParam],
  )

  return {
    page,
    pageSize,
    sort,
    order,
    q,
    debouncedQ,
    setParam,
    setSearch,
    toggleSort,
    setPage,
    setPageSize,
  }
}
