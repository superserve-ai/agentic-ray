"use client"

import { CalendarBlankIcon } from "@phosphor-icons/react"
import {
  Button,
  cn,
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@superserve/ui"
import { useEffect, useMemo, useState } from "react"

export interface DateRange {
  start: Date
  end: Date
}

interface DateRangeFilterProps {
  value: DateRange | null
  billingPeriod?: DateRange | null
  onChange: (range: DateRange | null) => void
}

type PresetKey = "billing-period" | "today" | "yesterday" | "7d" | "30d"

interface Preset {
  key: PresetKey
  label: string
  getRange: () => DateRange
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

const BILLING_PERIOD_PRESET: Preset = {
  key: "billing-period",
  label: "Billing Period",
  getRange: () => {
    throw new Error("Billing period preset requires a range")
  },
}

const QUICK_PRESETS: Preset[] = [
  {
    key: "today",
    label: "Today",
    getRange: () => ({
      start: startOfDay(new Date()),
      end: new Date(),
    }),
  },
  {
    key: "yesterday",
    label: "Yesterday",
    getRange: () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      return {
        start: startOfDay(yesterday),
        end: endOfDay(yesterday),
      }
    },
  },
  {
    key: "7d",
    label: "7D",
    getRange: () => {
      const start = new Date()
      start.setDate(start.getDate() - 7)
      return { start: startOfDay(start), end: new Date() }
    },
  },
  {
    key: "30d",
    label: "30D",
    getRange: () => {
      const start = new Date()
      start.setDate(start.getDate() - 30)
      return { start: startOfDay(start), end: new Date() }
    },
  },
]

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function parseDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

function startOfMonth(date: Date): Date {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function isSameDay(left: Date | null, right: Date | null): boolean {
  if (!left || !right) return false
  return startOfDay(left).getTime() === startOfDay(right).getTime()
}

function isValidCalendarSelection(
  start: Date | null,
  end: Date | null,
): start is Date {
  return !!start && !!end && end >= start
}

function buildMonthDays(month: Date): Array<Date | null> {
  const firstDay = startOfMonth(month)
  const firstWeekday = firstDay.getDay()
  const daysInMonth = new Date(
    firstDay.getFullYear(),
    firstDay.getMonth() + 1,
    0,
  ).getDate()
  const cells: Array<Date | null> = Array.from(
    { length: firstWeekday },
    () => null,
  )

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(
      new Date(firstDay.getFullYear(), firstDay.getMonth(), day, 12, 0, 0, 0),
    )
  }

  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function isSameRange(left: DateRange | null, right: DateRange | null): boolean {
  if (!left || !right) return false
  return (
    left.start.getTime() === right.start.getTime() &&
    left.end.getTime() === right.end.getTime()
  )
}

function getActivePreset(
  value: DateRange | null,
  billingPeriod: DateRange | null | undefined,
): PresetKey | null {
  if (!value) return null
  if (billingPeriod && isSameRange(value, billingPeriod)) {
    return "billing-period"
  }
  for (const preset of QUICK_PRESETS) {
    const range = preset.getRange()
    if (
      startOfDay(value.start).getTime() === startOfDay(range.start).getTime() &&
      startOfDay(value.end).getTime() === startOfDay(range.end).getTime()
    ) {
      return preset.key
    }
  }
  return null
}

export function DateRangeFilter({
  value,
  billingPeriod,
  onChange,
}: DateRangeFilterProps) {
  const [customStart, setCustomStart] = useState<Date | null>(null)
  const [customEnd, setCustomEnd] = useState<Date | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(value?.start ?? billingPeriod?.start ?? new Date()),
  )

  useEffect(() => {
    if (popoverOpen) return
    setVisibleMonth(
      startOfMonth(value?.start ?? billingPeriod?.start ?? new Date()),
    )
  }, [billingPeriod?.start, popoverOpen, value?.start])

  const activePreset = getActivePreset(value, billingPeriod)
  const isCustom = value && !activePreset
  const monthDays = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth])

  const handlePresetClick = (preset: Preset) => {
    if (preset.key === BILLING_PERIOD_PRESET.key) {
      onChange(billingPeriod ?? preset.getRange())
      return
    }
    if (activePreset === preset.key) {
      onChange(billingPeriod ?? null)
    } else {
      onChange(preset.getRange())
    }
  }

  const handleCustomApply = () => {
    if (!isValidCalendarSelection(customStart, customEnd)) {
      setCustomError("End date must be on or after the start date.")
      return
    }
    onChange({
      start: startOfDay(customStart),
      end: endOfDay(customEnd!),
    })
    setCustomError(null)
    setPopoverOpen(false)
  }

  const handleCustomClear = () => {
    onChange(billingPeriod ?? null)
    setCustomStart(null)
    setCustomEnd(null)
    setCustomError(null)
    setPopoverOpen(false)
  }

  return (
    <div className="flex items-center gap-1">
      {billingPeriod && (
        <button
          type="button"
          onClick={() => handlePresetClick(BILLING_PERIOD_PRESET)}
          className={cn(
            "cursor-pointer px-2 py-1 font-mono text-xs uppercase transition-colors",
            activePreset === BILLING_PERIOD_PRESET.key
              ? "bg-brand/10 text-foreground"
              : "text-muted hover:text-foreground",
          )}
        >
          {BILLING_PERIOD_PRESET.label}
        </button>
      )}
      {QUICK_PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          onClick={() => handlePresetClick(preset)}
          className={cn(
            "cursor-pointer px-2 py-1 font-mono text-xs uppercase transition-colors",
            activePreset === preset.key
              ? "bg-brand/10 text-foreground"
              : "text-muted hover:text-foreground",
          )}
        >
          {preset.label}
        </button>
      ))}

      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={
                isCustom
                  ? `Custom date range: ${formatShortDate(value.start)} to ${formatShortDate(value.end)}`
                  : "Select a custom date range"
              }
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 px-2 py-1 font-mono text-xs uppercase transition-colors",
                isCustom
                  ? "bg-brand/10 text-foreground"
                  : "text-muted hover:text-foreground",
              )}
            />
          }
        >
          <CalendarBlankIcon className="size-3.5" weight="light" />
          {isCustom
            ? `${formatShortDate(value.start)} – ${formatShortDate(value.end)}`
            : "Custom"}
        </PopoverTrigger>
        <PopoverPopup className="w-64 space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="font-mono text-xs text-muted uppercase hover:text-foreground"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
            >
              Prev
            </button>
            <span className="font-mono text-xs text-foreground uppercase">
              {visibleMonth.toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              type="button"
              className="font-mono text-xs text-muted uppercase hover:text-foreground"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
            >
              Next
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] text-muted uppercase">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthDays.map((day, index) => {
              const selected =
                isSameDay(day, customStart) || isSameDay(day, customEnd)
              const inRange =
                day &&
                customStart &&
                customEnd &&
                day > customStart &&
                day < customEnd
              return (
                <button
                  key={day?.toISOString() ?? `empty-${index}`}
                  type="button"
                  disabled={!day}
                  aria-label={day ? day.toDateString() : undefined}
                  onClick={() => {
                    if (!day) return
                    setCustomError(null)
                    if (!customStart || (customStart && customEnd)) {
                      setCustomStart(day)
                      setCustomEnd(null)
                      return
                    }
                    if (day < customStart) {
                      setCustomError(
                        "End date must be on or after the start date.",
                      )
                      return
                    }
                    setCustomEnd(day)
                  }}
                  className={cn(
                    "h-8 border border-border text-xs transition-colors",
                    !day && "border-transparent opacity-0",
                    selected
                      ? "bg-brand/10 text-foreground"
                      : inRange
                        ? "bg-brand/5 text-foreground"
                        : "text-muted hover:bg-brand/10 hover:text-foreground",
                  )}
                >
                  {day ? day.getDate() : ""}
                </button>
              )
            })}
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="border border-border px-2 py-1">
                <span className="block font-mono text-[10px] text-muted uppercase">
                  Start
                </span>
                <span className="font-mono text-xs text-foreground">
                  {customStart ? formatShortDate(customStart) : "Pick a date"}
                </span>
              </div>
              <div className="border border-border px-2 py-1">
                <span className="block font-mono text-[10px] text-muted uppercase">
                  End
                </span>
                <span className="font-mono text-xs text-foreground">
                  {customEnd ? formatShortDate(customEnd) : "Pick a date"}
                </span>
              </div>
            </div>
          </div>
          {customError && (
            <p className="font-mono text-xs text-destructive">{customError}</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleCustomApply}
              disabled={!customStart || !customEnd}
              className="flex-1"
            >
              Apply
            </Button>
            {isCustom && (
              <Button size="sm" variant="ghost" onClick={handleCustomClear}>
                Clear
              </Button>
            )}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  )
}
