"use client"

import { CaretUpDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import {
  cn,
  Input,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  Skeleton,
} from "@superserve/ui"
import { useEffect, useMemo, useRef, useState } from "react"

import type { ProviderShortcut } from "@/lib/api/types"

import { AUTH_TYPE_LABEL } from "./auth-type-label"

interface ProviderPickerProps {
  providers: ProviderShortcut[] | undefined
  isPending: boolean
  value: string | null
  onSelect: (provider: ProviderShortcut) => void
}

function hostHint(p: ProviderShortcut): string {
  return p.hosts.length > 1
    ? `${p.hosts[0]} +${p.hosts.length - 1}`
    : (p.hosts[0] ?? "")
}

function subtitle(p: ProviderShortcut): string {
  return `${AUTH_TYPE_LABEL[p.auth_type]} · ${hostHint(p)}`
}

export function ProviderPicker({
  providers,
  isPending,
  value,
  onSelect,
}: ProviderPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [triggerWidth, setTriggerWidth] = useState<number>()

  const selected = useMemo(
    () => providers?.find((p) => p.name === value) ?? null,
    [providers, value],
  )

  const matches = useMemo(() => {
    if (!providers) return []
    const q = query.trim().toLowerCase()
    if (!q) return providers
    return providers.filter(
      (p) =>
        p.display.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    )
  }, [providers, query])

  // Keep the highlighted row in range as the filtered set changes.
  useEffect(() => {
    setActive(0)
  }, [query])

  // Match the popup width to the trigger so rows line up under it.
  useEffect(() => {
    if (open) setTriggerWidth(triggerRef.current?.offsetWidth)
  }, [open])

  // Scroll the highlighted row into view during keyboard navigation.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`,
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [active, open])

  const commit = (p: ProviderShortcut) => {
    onSelect(p)
    setOpen(false)
    setQuery("")
  }

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const p = matches[active]
      if (p) commit(p)
    }
  }

  if (isPending) {
    return <Skeleton className="h-9 w-full" />
  }

  if (!providers?.length) {
    return (
      <p className="text-xs text-muted">No provider shortcuts available.</p>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        ref={triggerRef}
        render={
          <button
            type="button"
            aria-label={
              selected
                ? `Selected provider: ${selected.display}`
                : "Select a provider"
            }
            className={cn(
              "flex h-9 w-full items-center justify-between border border-input bg-background px-3 text-sm",
              "focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
              selected ? "text-foreground" : "text-muted",
            )}
          />
        }
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">
            {selected ? selected.display : "Select a provider…"}
          </span>
          {selected && (
            <span className="truncate font-mono text-[10px] text-muted">
              {subtitle(selected)}
            </span>
          )}
        </span>
        <CaretUpDownIcon
          weight="light"
          className="h-4 w-4 shrink-0 text-muted"
        />
      </PopoverTrigger>

      <PopoverPopup
        initialFocus={inputRef}
        className="p-0"
        style={triggerWidth ? { width: triggerWidth } : undefined}
      >
        <div className="border-b border-dashed border-border p-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search providers…"
            suffix={
              <MagnifyingGlassIcon
                weight="light"
                className="h-4 w-4 text-muted"
              />
            }
          />
        </div>

        <div
          ref={listRef}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- custom combobox listbox, not a native <select>
          role="listbox"
          className="max-h-64 overflow-y-auto p-1"
        >
          {matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted">
              No providers match “{query.trim()}”.
            </p>
          ) : (
            matches.map((p, i) => {
              const isSelected = p.name === value
              const isActive = i === active
              return (
                <button
                  key={p.name}
                  type="button"
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- combobox option row, not a native <option>
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  onClick={() => commit(p)}
                  onMouseMove={() => setActive(i)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors",
                    isActive
                      ? "bg-foreground text-background"
                      : "text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2 text-xs font-medium">
                    {p.display}
                    {isSelected && (
                      <span
                        className={cn(
                          "font-mono text-[10px]",
                          isActive ? "text-background/70" : "text-muted",
                        )}
                      >
                        selected
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "truncate font-mono text-[10px]",
                      isActive ? "text-background/70" : "text-muted",
                    )}
                  >
                    {subtitle(p)}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </PopoverPopup>
    </Popover>
  )
}
