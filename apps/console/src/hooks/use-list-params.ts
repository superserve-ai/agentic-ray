"use client"

import { useSearchParams } from "next/navigation"
import { useCallback } from "react"

import type { SortDirection } from "@/lib/api/types"

import { useDebouncedValue } from "./use-debounced-value"

const SEARCH_DEBOUNCE_MS = 300
// Mirrors the backend's maxPageSize so a hand-crafted ?size= can't desync the
// pager's math (page count / "X of Y") from the rows the API will actually
// return.
const MAX_PAGE_SIZE = 200

interface UseListParamsConfig<C extends string> {
  /**
   * Sort columns the API accepts. URL params are user input — an unknown
   * ?sort= (typo, stale link after a column rename) falls back to defaultSort
   * instead of reaching the API and failing the whole page.
   */
  columns: readonly C[]
  defaultSort: C
  defaultPageSize?: number
}

/**
 * Manages the shared URL state for a paginated list page: page, page size,
 * sort column + direction, and name search. Filter tabs (status, owner, …) are
 * page-specific and set through the returned `setParam` helper.
 *
 * The URL is the single source of truth, so pages are shareable and survive
 * refresh / back-forward. The search input and URL update on every keystroke
 * (shallowly — no server round-trip); only `debouncedQ` (fed to the query)
 * lags, so typing doesn't fire a request per character. Any filter/sort/search
 * change resets back to page 1.
 */
export function useListParams<C extends string>({
  columns,
  defaultSort,
  defaultPageSize = 50,
}: UseListParamsConfig<C>) {
  const searchParams = useSearchParams()

  const page = Math.max(1, Math.trunc(Number(searchParams.get("page")) || 1))
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      Math.trunc(Number(searchParams.get("size")) || defaultPageSize),
    ),
  )
  const rawSort = searchParams.get("sort")
  const sort = columns.find((c) => c === rawSort) ?? defaultSort
  const order: SortDirection =
    searchParams.get("order") === "asc" ? "asc" : "desc"
  const q = searchParams.get("q") ?? ""
  // Trimmed so "node " (or a lone space) doesn't become a zero-match filter.
  const debouncedQ = useDebouncedValue(q, SEARCH_DEBOUNCE_MS).trim()

  const setParam = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(window.location.search)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key)
        else next.set(key, value)
      }
      // Any filter/sort/search change sends the user back to page 1, unless the
      // caller is explicitly navigating pages.
      if (resetPage && !("page" in patch)) next.delete("page")
      const path = window.location.pathname
      const qs = next.toString()
      // These params only drive client-side queries, so update the URL
      // shallowly (Next syncs useSearchParams from the History API). Going
      // through router.replace would fetch the route's RSC payload on every
      // search keystroke and let the async URL state fight the controlled
      // search input.
      window.history.replaceState(null, "", qs ? `${path}?${qs}` : path)
    },
    [],
  )

  const setSearch = useCallback(
    (value: string) => setParam({ q: value || null }),
    [setParam],
  )

  const toggleSort = useCallback(
    (column: C) => {
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
