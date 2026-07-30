"use client"

import { ChartBarIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { SortableTableHead } from "@/components/sortable-table-head"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import type {
  PlatformBillingRow,
  PlatformBillingRowSummary,
  PlatformBillingSortColumn,
  PlatformBillingSummary,
} from "@/lib/api/platform-billing"
import type { SortDirection } from "@/lib/api/types"

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return "Current billing period"
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
  return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value))
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border/80 bg-background/75 p-4">
      <div className="text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
        {formatCurrency(value)}
      </div>
    </div>
  )
}

function UsageCell({ summary }: { summary: PlatformBillingRowSummary | null }) {
  if (!summary) {
    return <span className="text-sm text-muted">Unavailable</span>
  }

  return (
    <div>
      <div className="font-mono font-medium tabular-nums">
        {formatCurrency(summary.current_charges_usd)}
      </div>
      <div className="mt-1 text-xs text-muted">
        Compute {formatCurrency(summary.cost_breakdown_usd.compute)} · Memory{" "}
        {formatCurrency(summary.cost_breakdown_usd.memory)} · Storage{" "}
        {formatCurrency(summary.cost_breakdown_usd.storage)}
      </div>
      <div className="mt-1 text-xs text-muted">
        {summary.pricing_tier.plan_name} · {summary.pricing_tier.currency} ·{" "}
        calculated {formatDateTime(summary.calculated_at)}
      </div>
    </div>
  )
}

function BillingMeta({
  summary,
  error,
}: {
  summary: PlatformBillingRowSummary | null
  error: string | null
}) {
  if (!summary) {
    return (
      <div className="mt-1 text-xs text-destructive" title={error ?? undefined}>
        Billing unavailable{error ? `: ${error}` : ""}
      </div>
    )
  }

  return (
    <div className="mt-1 text-xs text-muted">
      {formatPeriod(summary.billing_period.start, summary.billing_period.end)} ·{" "}
      {summary.pricing_tier.plan_name} · {summary.pricing_tier.currency} ·{" "}
      calculated {formatDateTime(summary.calculated_at)}
    </div>
  )
}

function formatRowError(error: PlatformBillingRow["error"]): string | null {
  if (!error) return null
  if (typeof error === "string") return error
  return error.code ? `${error.code}: ${error.message}` : error.message
}

function updateSearchParams(
  searchParams: URLSearchParams,
  patch: Record<string, string | null>,
  resetPage = true,
): URLSearchParams {
  const next = new URLSearchParams(searchParams.toString())
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") next.delete(key)
    else next.set(key, value)
  }
  if (resetPage && !("page" in patch)) next.delete("page")
  return next
}

export interface PlatformBillingPageProps {
  summary: PlatformBillingSummary
  page: number
  pageSize: number
  sort: PlatformBillingSortColumn
  order: SortDirection
  search: string
}

export function PlatformBillingPage({
  summary,
  page,
  pageSize,
  sort,
  order,
  search,
}: PlatformBillingPageProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(search)
  const debouncedQuery = useDebouncedValue(query, 300)
  const effectivePageSize = summary.pagination.limit || pageSize
  const pageCount = Math.max(
    1,
    Math.ceil(summary.pagination.total / effectivePageSize),
  )
  const currentPeriod = summary.rows.find((row) => row.summary)?.summary ?? null

  useEffect(() => {
    setQuery(search)
  }, [search])

  useEffect(() => {
    if (debouncedQuery === search) return
    const next = updateSearchParams(
      new URLSearchParams(searchParams.toString()),
      { search: debouncedQuery || null },
    )
    router.replace(next.toString() ? `${pathname}?${next}` : pathname)
  }, [debouncedQuery, pathname, router, search, searchParams])

  useEffect(() => {
    if (page > pageCount) {
      const next = updateSearchParams(
        new URLSearchParams(searchParams.toString()),
        { page: String(pageCount) },
        false,
      )
      router.replace(next.toString() ? `${pathname}?${next}` : pathname)
    }
  }, [page, pageCount, pathname, router, searchParams])

  const setParam = (patch: Record<string, string | null>, resetPage = true) => {
    const next = updateSearchParams(
      new URLSearchParams(searchParams.toString()),
      patch,
      resetPage,
    )
    router.replace(next.toString() ? `${pathname}?${next}` : pathname)
  }

  const emptyState =
    summary.pagination.total === 0
      ? search
        ? {
            title: "No customers match that search",
            description: "Try a different customer name or clear the search.",
          }
        : {
            title: "No platform billing data yet",
            description:
              "Billing data will appear here once the platform API returns rows.",
          }
      : null

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Platform Billing" />

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            {formatPeriod(
              currentPeriod?.billing_period.start ?? null,
              currentPeriod?.billing_period.end ?? null,
            )}
          </h2>
          <p className="mt-1 text-xs text-muted">
            Totals across all customers with available billing data.
          </p>
          <p className="mt-1 text-xs text-muted">
            {summary.totals.teams} teams · {summary.totals.succeeded} succeeded
            · {summary.totals.failed} failed
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Usage subtotal"
            value={summary.totals.current_charges_usd}
          />
          <SummaryCard
            label="Credits applied"
            value={summary.totals.credits_applied_usd}
          />
          <SummaryCard
            label="Net due"
            value={summary.totals.expected_invoice_amount_usd}
          />
          <SummaryCard
            label="Credits remaining"
            value={summary.totals.credits_remaining_usd}
          />
        </div>

        {emptyState ? (
          <EmptyState
            icon={search ? MagnifyingGlassIcon : ChartBarIcon}
            title={emptyState.title}
            description={emptyState.description}
          />
        ) : (
          <>
            <TableToolbar
              searchPlaceholder="Search customers..."
              searchValue={query}
              onSearchChange={setQuery}
            />

            <div className="border border-border/80">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background/90 backdrop-blur-md">
                  <TableRow>
                    <SortableTableHead
                      column="team_name"
                      label="Customer"
                      activeSort={sort}
                      order={order}
                      onSort={(column) =>
                        setParam({
                          sort: column,
                          order:
                            sort === column && order === "asc" ? "desc" : "asc",
                        })
                      }
                      className="w-[28%]"
                    />
                    <SortableTableHead
                      column="current_charges_usd"
                      label="Usage"
                      activeSort={sort}
                      order={order}
                      onSort={(column) =>
                        setParam({
                          sort: column,
                          order:
                            sort === column && order === "asc" ? "desc" : "asc",
                        })
                      }
                      className="w-[32%]"
                    />
                    <TableHead className="w-[16%]">Credits applied</TableHead>
                    <SortableTableHead
                      column="expected_invoice_amount_usd"
                      label="Net due"
                      activeSort={sort}
                      order={order}
                      onSort={(column) =>
                        setParam({
                          sort: column,
                          order:
                            sort === column && order === "asc" ? "desc" : "asc",
                        })
                      }
                      className="w-[12%]"
                    />
                    <SortableTableHead
                      column="credits_remaining_usd"
                      label="Credits left"
                      activeSort={sort}
                      order={order}
                      onSort={(column) =>
                        setParam({
                          sort: column,
                          order:
                            sort === column && order === "asc" ? "desc" : "asc",
                        })
                      }
                      className="w-[12%]"
                    />
                  </TableRow>
                </TableHeader>
                <StickyHoverTableBody>
                  {summary.rows.map((row) => {
                    const error = formatRowError(row.error)
                    const rowSummary = row.summary
                    return (
                      <TableRow key={row.team_id}>
                        <TableCell>
                          <div className="font-medium">{row.team_name}</div>
                          <BillingMeta summary={rowSummary} error={error} />
                        </TableCell>
                        <TableCell>
                          <UsageCell summary={rowSummary} />
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {rowSummary
                            ? formatCurrency(rowSummary.credits_applied_usd)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {rowSummary
                            ? formatCurrency(
                                rowSummary.expected_invoice_amount_usd,
                              )
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {rowSummary
                            ? formatCurrency(rowSummary.credits_remaining_usd)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </StickyHoverTableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      {summary.pagination.total > 0 && !emptyState && (
        <Pagination
          page={page}
          pageSize={effectivePageSize}
          total={summary.pagination.total}
          onPageChange={(nextPage) =>
            setParam({ page: String(nextPage) }, false)
          }
          onPageSizeChange={(nextPageSize) =>
            setParam({ size: String(nextPageSize) })
          }
        />
      )}
    </div>
  )
}
