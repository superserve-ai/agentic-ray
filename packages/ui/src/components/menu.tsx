"use client"

import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "../lib/utils"

const Menu = MenuPrimitive.Root
const MenuTrigger = MenuPrimitive.Trigger

function MenuPopup({
  className,
  sideOffset = 4,
  side,
  align,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> & {
  sideOffset?: number
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        sideOffset={sideOffset}
        side={side}
        align={align}
        className="z-50"
      >
        <MenuPrimitive.Popup
          className={cn(
            "ss-menu-popup z-50 min-w-32 border border-dashed border-border bg-surface/80 p-1 backdrop-blur-xl",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-foreground transition-colors outline-none select-none",
        "hover:bg-surface-hover focus:bg-surface-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-30",
        className,
      )}
      {...props}
    />
  )
}

function MenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger }
