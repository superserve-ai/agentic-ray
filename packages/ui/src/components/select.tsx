"use client"

import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CaretUpDownIcon } from "@phosphor-icons/react"

import { cn } from "../lib/utils"

const Select = SelectPrimitive.Root
const SelectValue = SelectPrimitive.Value

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between border border-input bg-background px-3 text-sm text-foreground",
        "focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-30",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <CaretUpDownIcon weight="light" className="h-4 w-4 text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectPopup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup>) {
  return (
    <SelectPrimitive.Portal>
      {/* z-index must sit on the Positioner — the fixed-position element that
          competes at body level. On the Popup alone it only wins inside the
          Positioner's stacking context, so the popup paints under elevated
          app surfaces (e.g. a z-40 sidebar) that overlap its anchor. */}
      <SelectPrimitive.Positioner className="z-50">
        <SelectPrimitive.Popup
          className={cn(
            "ss-select-popup z-50 max-h-72 min-w-[8rem] overflow-auto border border-dashed border-border bg-surface/80 p-1 backdrop-blur-xl",
            className,
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "flex w-full cursor-pointer items-center px-2 py-1.5 text-sm text-foreground outline-none select-none",
        "focus:bg-surface-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue }
