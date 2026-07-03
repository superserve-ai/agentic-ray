"use client"

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react"
import {
  Button,
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@superserve/ui"

import { CornerBrackets } from "./corner-brackets"

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100]

type PageToken = number | "ellipsis"

/**
 * Elided page list: first + last page always shown, current ±1 in the middle,
 * with "ellipsis" tokens standing in for the gaps. Short ranges (≤ 7 pages)
 * render every page.
 */
function pageRange(current: number, pageCount: number): PageToken[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  const tokens: PageToken[] = [1]
  const left = Math.max(2, current - 1)
  const right = Math.min(pageCount - 1, current + 1)
  if (left > 2) tokens.push("ellipsis")
  for (let p = left; p <= right; p++) tokens.push(p)
  if (right < pageCount - 1) tokens.push("ellipsis")
  tokens.push(pageCount)
  return tokens
}

interface PaginationProps {
  /** 1-based current page. */
  page: number
  pageSize: number
  /** Total rows across all pages (from the API's X-Total-Count). */
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  pageSizeOptions?: number[]
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1
  const end = Math.min(current * pageSize, total)
  const tokens = pageRange(current, pageCount)

  return (
    <nav
      aria-label="Pagination"
      className="flex h-12 shrink-0 items-center justify-between border-t border-border bg-background px-4"
    >
      <p className="font-mono text-xs text-muted tabular-nums">
        {start}
        <span className="text-muted/60">–</span>
        {end} <span className="text-muted/60">of</span> {total}
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          <CaretLeftIcon className="size-3.5" weight="light" />
        </Button>

        {tokens.map((token, i) =>
          token === "ellipsis" ? (
            <span
              // eslint-disable-next-line react/no-array-index-key -- ellipsis tokens have no stable id; position is their identity
              key={`gap-${i}`}
              className="px-1 font-mono text-xs text-muted"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              key={token}
              type="button"
              onClick={() => onPageChange(token)}
              aria-current={token === current ? "page" : undefined}
              className={cn(
                "relative inline-flex h-8 min-w-8 cursor-pointer items-center justify-center px-2 font-mono text-xs tabular-nums transition-colors",
                token === current
                  ? "bg-brand/10 text-foreground"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {token === current && <CornerBrackets size="sm" />}
              <span className="relative">{token}</span>
            </button>
          ),
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pageCount}
          aria-label="Next page"
        >
          <CaretRightIcon className="size-3.5" weight="light" />
        </Button>

        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 text-xs text-muted"
                aria-label="Rows per page"
              >
                {pageSize} / page
              </Button>
            }
          />
          <MenuPopup align="end">
            {pageSizeOptions.map((size) => (
              <MenuItem key={size} onClick={() => onPageSizeChange(size)}>
                {size} / page
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
    </nav>
  )
}
