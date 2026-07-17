"use client"

import { Suspense } from "react"

import { TableSkeleton } from "@/components/table-skeleton"

export default function AuditLogsPage() {
  return (
    <Suspense fallback={<TableSkeleton columns={6} tabs={4} />}>
      <AuditLogsPageContent />
    </Suspense>
  )
}

import { ClipboardTextIcon } from "@phosphor-icons/react"
import { cn, Table, TableHead, TableHeader, TableRow } from "@superserve/ui"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import {
  ActivityDetailRow,
  ActivitySummaryRow,
} from "@/components/audit/activity-row"
import { type DateRange, DateRangeFilter } from "@/components/date-range-filter"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { useQueryScope } from "@/components/query-provider"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"
import { useActivityPage } from "@/hooks/use-activity"
import { useListParams } from "@/hooks/use-list-params"
import { useUser } from "@/hooks/use-user"
import { canReadPlatformActivity } from "@/lib/admin/permissions"
import { ACTIVITY_SORT_COLUMNS, type ActivityListParams } from "@/lib/api/types"

const CATEGORY_TABS = [
  { label: "All", value: "all" },
  { label: "Sandbox", value: "sandbox" },
  { label: "Template", value: "template" },
  { label: "Exec", value: "exec" },
  { label: "Secret", value: "secret" },
  { label: "Errors", value: "_errors" },
]

/** Parses ?start/?end ISO params into a DateRange, ignoring invalid values so
 * a hand-crafted URL can't send an unparseable timestamp to the API. */
function parseDateRange(
  startParam: string | null,
  endParam: string | null,
): DateRange | null {
  if (!startParam || !endParam) return null
  const start = new Date(startParam)
  const end = new Date(endParam)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  // Reject an inverted range (mirrors DateRangeFilter's own end >= start
  // invariant) so a reversed or corrupted URL degrades to "no filter" instead
  // of silently returning an empty result set.
  if (end < start) return null
  return { start, end }
}

function AuditLogsPageContent() {
  const searchParams = useSearchParams()
  const queryScope = useQueryScope()
  const { user, loading: userLoading } = useUser()
  const canReadCurrentScope =
    queryScope === "self" || canReadPlatformActivity(user)

  const {
    page,
    pageSize,
    sort,
    order,
    q,
    debouncedQ,
    setParam,
    setPage,
    setPageSize,
    setSearch,
  } = useListParams({
    columns: ACTIVITY_SORT_COLUMNS,
    defaultSort: "created_at",
  })

  // The active category tab lives in the URL; an unknown value falls back to
  // "all" instead of being forwarded to the API.
  const rawTab = searchParams.get("tab")
  const activeTab = CATEGORY_TABS.some((t) => t.value === rawTab)
    ? (rawTab as string)
    : "all"
  // The Errors tab filters by status; the resource tabs filter by category.
  const category =
    activeTab !== "all" && activeTab !== "_errors" ? activeTab : undefined
  const status = activeTab === "_errors" ? "error" : undefined

  const dateRange = parseDateRange(
    searchParams.get("start"),
    searchParams.get("end"),
  )

  const [expandedId, setExpandedId] = useState<string | null>(null)

  const params: ActivityListParams = {
    page,
    pageSize,
    sort,
    order,
    category,
    status,
    q: debouncedQ || undefined,
    start: dateRange?.start.toISOString(),
    end: dateRange?.end.toISOString(),
  }

  const { data, isPending, error, refetch, isPlaceholderData } =
    useActivityPage(params, {
      enabled: queryScope === "self" || (!userLoading && canReadCurrentScope),
    })
  const logs = data?.items ?? []
  const total = data?.total ?? 0

  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // If the current page falls past the end (e.g. after a filter narrows the
  // result set), snap back to the last valid page.
  useEffect(() => {
    if (total > 0 && page > pageCount) setPage(pageCount)
  }, [total, page, pageCount, setPage])

  const handleDateChange = (range: DateRange | null) => {
    setParam({
      start: range ? range.start.toISOString() : null,
      end: range ? range.end.toISOString() : null,
    })
  }

  // Uses debouncedQ (what the data was fetched with), not q: clearing a
  // zero-result search would otherwise flash the account-level empty state
  // until the unfiltered refetch lands.
  const hasFilters =
    activeTab !== "all" || debouncedQ !== "" || dateRange !== null
  // A truly empty account gets the informational empty state; a zero-result
  // filter keeps the toolbar so the user can clear it. Placeholder data is a
  // stale page during a params change — never treat its total as empty.
  const isEmpty =
    !isPending && !error && !isPlaceholderData && total === 0 && !hasFilters

  if (queryScope !== "self" && !userLoading && !canReadCurrentScope) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Audit Logs" />
        <ErrorState message="Your account does not have platform activity read access for this team." />
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Audit Logs" />
        <TableSkeleton columns={6} tabs={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Audit Logs" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Audit Logs" />

      {isEmpty ? (
        <EmptyState
          icon={ClipboardTextIcon}
          title="No Activity Yet"
          description="Audit logs will appear here once you start using Superserve."
        />
      ) : (
        <>
          <TableToolbar
            tabs={CATEGORY_TABS}
            activeTab={activeTab}
            onTabChange={(v) => setParam({ tab: v === "all" ? null : v })}
            filters={
              <DateRangeFilter value={dateRange} onChange={handleDateChange} />
            }
            searchPlaceholder="Search by sandbox, secret, or action..."
            searchValue={q}
            onSearchChange={setSearch}
          />

          <div
            className={cn(
              "flex-1 overflow-y-auto transition-opacity",
              isPlaceholderData && "opacity-60",
            )}
          >
            {logs.length === 0 ? (
              <EmptyState
                icon={ClipboardTextIcon}
                title="No activity matches"
                description="Try a different search term, category, or date range."
              />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
                  <TableRow>
                    <TableHead className="w-[20%]">Time</TableHead>
                    <TableHead className="w-[20%]">Resource</TableHead>
                    <TableHead className="w-[12%]">Category</TableHead>
                    <TableHead className="w-[15%]">Action</TableHead>
                    <TableHead className="w-[10%]">Duration</TableHead>
                    <TableHead className="w-[12%]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <StickyHoverTableBody>
                  {logs.flatMap((log) => {
                    const isOpen = expandedId === log.id
                    const rows = [
                      <ActivitySummaryRow
                        key={log.id}
                        log={log}
                        isOpen={isOpen}
                        onToggle={() =>
                          setExpandedId((prev) =>
                            prev === log.id ? null : log.id,
                          )
                        }
                      />,
                    ]
                    if (isOpen) {
                      rows.push(
                        <ActivityDetailRow
                          key={`${log.id}-detail`}
                          log={log}
                        />,
                      )
                    }
                    return rows
                  })}
                </StickyHoverTableBody>
              </Table>
            )}
          </div>

          {total > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </>
      )}
    </div>
  )
}
