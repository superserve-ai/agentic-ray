"use client"

import { cn } from "@superserve/ui"
import type { ReactNode } from "react"

interface StickyHoverTableBodyProps {
  children: ReactNode
  className?: string
}

export function StickyHoverTableBody({
  children,
  className,
}: StickyHoverTableBodyProps) {
  return (
    <tbody
      className={cn(
        "relative [&_tr:last-child]:border-0 [&_tr:not([aria-hidden='true']):not([data-detail-row='true']):hover]:bg-brand/5",
        className,
      )}
    >
      {children}
    </tbody>
  )
}
