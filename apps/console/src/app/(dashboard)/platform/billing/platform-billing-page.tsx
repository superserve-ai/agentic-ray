"use client"

import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import {
  Input,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useMemo, useState } from "react"

import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import type {
  PlatformBillingRow,
  PlatformBillingSummary,
} from "@/lib/admin/billing-actions"

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

function UsageCell({ row }: { row: PlatformBillingRow }) {
  if (row.billing_mode === "unavailable") {
    return <span className="text-sm text-muted">Unavailable</span>
  }

  return (
    <div>
      <div className="font-mono font-medium tabular-nums">
        {formatCurrency(row.current_charges_usd)}
      </div>
      <div className="mt-1 text-xs text-muted">
        Compute {formatCurrency(row.compute_usd)} · Memory{" "}
        {formatCurrency(row.memory_usd)} · Storage{" "}
        {formatCurrency(row.storage_usd)}
      </div>
    </div>
  )
}

export function PlatformBillingPage({
  summary,
}: {
  summary: PlatformBillingSummary
}) {
  const [query, setQuery] = useState("")
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return summary.rows
    return summary.rows.filter(
      (row) =>
        row.team_name.toLowerCase().includes(normalized) ||
        row.team_id.toLowerCase().includes(normalized),
    )
  }, [query, summary.rows])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Platform Billing" />
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            {formatPeriod(summary.period_start, summary.period_end)}
          </h2>
          <p className="mt-1 text-xs text-muted">
            Totals across all customers with available billing data.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Usage subtotal"
            value={summary.current_charges_usd}
          />
          <SummaryCard
            label="Credits applied"
            value={summary.credits_applied_usd}
          />
          <SummaryCard
            label="Net due"
            value={summary.expected_invoice_amount_usd}
          />
          <SummaryCard
            label="Credits remaining"
            value={summary.credits_remaining_usd}
          />
        </div>

        <div className="relative max-w-md">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            aria-label="Filter customers by name"
            placeholder="Search customer or team ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>

        <div className="border border-border/80">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/90 backdrop-blur-md">
              <TableRow>
                <TableHead className="w-[28%]">Customer</TableHead>
                <TableHead className="w-[32%]">Usage</TableHead>
                <TableHead className="w-[16%] text-right">
                  Credits applied
                </TableHead>
                <TableHead className="w-[12%] text-right">Net due</TableHead>
                <TableHead className="w-[12%] text-right">
                  Credits left
                </TableHead>
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {filteredRows.map((row) => (
                <TableRow key={`${row.region}:${row.team_id}`}>
                  <TableCell>
                    <div className="font-medium">{row.team_name}</div>
                    {row.billing_mode === "unavailable" && (
                      <div
                        className="mt-1 text-xs text-destructive"
                        title={row.error}
                      >
                        Billing unavailable
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <UsageCell row={row} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.billing_mode === "active"
                      ? formatCurrency(row.credits_applied_usd)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold tabular-nums">
                    {row.billing_mode === "active"
                      ? formatCurrency(row.expected_invoice_amount_usd)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.billing_mode === "active"
                      ? formatCurrency(row.credits_remaining_usd)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </StickyHoverTableBody>
          </Table>
          {filteredRows.length === 0 && (
            <div className="p-8 text-center text-sm text-muted">
              No customers match “{query}”.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
