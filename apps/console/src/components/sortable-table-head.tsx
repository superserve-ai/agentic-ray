"use client"

import {
  CaretDownIcon,
  CaretUpDownIcon,
  CaretUpIcon,
} from "@phosphor-icons/react"
import { cn, TableHead } from "@superserve/ui"

import type { SortDirection } from "@/lib/api/types"

interface SortableTableHeadProps {
  /** Sort column value sent to the API (e.g. "name", "created_at"). */
  column: string
  label: string
  activeSort: string
  order: SortDirection
  onSort: (column: string) => void
  className?: string
}

export function SortableTableHead({
  column,
  label,
  activeSort,
  order,
  onSort,
  className,
}: SortableTableHeadProps) {
  const isActive = activeSort === column

  return (
    <TableHead className={cn("p-0", className)}>
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={`Sort by ${label}`}
        className={cn(
          "group inline-flex h-10 w-full cursor-pointer items-center gap-1 px-4 font-mono text-xs font-medium tracking-wider uppercase transition-colors",
          isActive ? "text-foreground" : "text-muted hover:text-foreground",
        )}
      >
        {label}
        {isActive ? (
          order === "asc" ? (
            <CaretUpIcon className="size-3" weight="bold" />
          ) : (
            <CaretDownIcon className="size-3" weight="bold" />
          )
        ) : (
          <CaretUpDownIcon
            className="size-3 opacity-0 transition-opacity group-hover:opacity-40"
            weight="bold"
          />
        )}
      </button>
    </TableHead>
  )
}
