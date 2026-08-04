"use client"

import { MagnifyingGlassIcon, TrashIcon } from "@phosphor-icons/react"
import { Button, cn, Input } from "@superserve/ui"
import { motion } from "motion/react"
import { useState } from "react"

import { CornerBrackets } from "./corner-brackets"

interface FilterTab {
  label: string
  value: string
  count?: number
}

interface TableToolbarProps {
  id?: string
  tabs?: FilterTab[]
  activeTab?: string
  onTabChange?: (value: string) => void
  filters?: React.ReactNode
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  selectedCount?: number
  onClearSelection?: () => void
  onDeleteSelected?: () => void
  deleteLabel?: string
}

export function TableToolbar({
  id = "toolbar",
  tabs,
  activeTab,
  onTabChange,
  filters,
  searchPlaceholder = "Search...",
  searchValue = "",
  onSearchChange,
  selectedCount = 0,
  onClearSelection,
  onDeleteSelected,
  deleteLabel = "Delete",
}: TableToolbarProps) {
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      {/* Left side: selection actions or filter tabs */}
      <div
        className="flex items-center gap-1"
        onMouseLeave={() => setHoveredTab(null)}
      >
        {selectedCount > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{selectedCount} selected</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={onClearSelection}
            >
              Clear
            </Button>
            {onDeleteSelected && (
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs"
                onClick={onDeleteSelected}
              >
                <TrashIcon className="size-3" weight="light" />
                {deleteLabel}
              </Button>
            )}
          </div>
        ) : (
          tabs?.map((tab) => {
            const isActive = activeTab === tab.value
            const isHovered = hoveredTab === tab.value

            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onTabChange?.(tab.value)}
                onMouseEnter={() => setHoveredTab(tab.value)}
                className={cn(
                  "relative inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {isHovered && (
                  <motion.span
                    className="absolute inset-0 bg-brand/10"
                    layoutId={`${id}-hover`}
                    transition={{
                      type: "spring",
                      bounce: 0.15,
                      duration: 0.4,
                    }}
                  />
                )}
                {isActive && !hoveredTab && (
                  <span className="absolute inset-0 bg-brand/10" />
                )}
                {isActive && (
                  <motion.span
                    className="pointer-events-none absolute inset-0"
                    layoutId={`${id}-active`}
                    transition={{
                      type: "spring",
                      bounce: 0.15,
                      duration: 0.5,
                    }}
                  >
                    <CornerBrackets size="sm" />
                  </motion.span>
                )}
                <span className="relative">{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={cn(
                      "relative min-w-4 text-center font-mono text-[10px]",
                      isActive ? "text-foreground" : "text-muted",
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>

      {/* Filters + Search */}
      <div className="flex items-center gap-2">
        {filters}
        <Input
          type="text"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange?.(e.target.value)}
          suffix={<MagnifyingGlassIcon className="size-3.5" weight="light" />}
          className="h-8 w-48 text-xs"
        />
      </div>
    </div>
  )
}
