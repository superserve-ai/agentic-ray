"use client"

import { cn, Tooltip, TooltipPopup, TooltipTrigger } from "@superserve/ui"
import { motion } from "motion/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"

import type { NavItem } from "./nav-config"
import { useSidebar } from "./sidebar-context"

interface SidebarNavProps {
  items: NavItem[]
  groupId: string
}

export function SidebarNav({ items, groupId }: SidebarNavProps) {
  const pathname = usePathname()
  const { isCollapsed } = useSidebar()
  const [hoveredHref, setHoveredHref] = useState<string | null>(null)

  return (
    <div
      className="flex flex-col gap-0.5 px-2.5"
      onMouseLeave={() => setHoveredHref(null)}
    >
      {items.map((item) => {
        const isActive = !item.external && pathname.startsWith(item.href)
        const isHovered = hoveredHref === item.href
        const Icon = item.icon

        const inner = (
          <>
            {isHovered && (
              <motion.span
                className="absolute inset-0 bg-brand/10"
                layoutId={`sidebar-hover-${groupId}-${isCollapsed}`}
                transition={{
                  type: "spring",
                  bounce: 0.15,
                  duration: 0.4,
                }}
              />
            )}
            {isActive && !hoveredHref && (
              <span className="absolute inset-0 bg-brand/10" />
            )}
            {isActive && (
              <motion.span
                className="pointer-events-none absolute inset-0"
                layoutId={`sidebar-active-${groupId}-${isCollapsed}`}
                transition={{
                  type: "spring",
                  bounce: 0.15,
                  duration: 0.5,
                }}
              >
                <CornerBrackets size="sm" className="border-brand/50" />
              </motion.span>
            )}
            <Icon className="relative size-4 shrink-0" weight="light" />
            {!isCollapsed && (
              <span className="relative text-sm leading-none tracking-tight">
                {item.label}
              </span>
            )}
          </>
        )

        const className = cn(
          "relative flex items-center gap-2.5 px-2.5 py-2.5 transition-colors",
          isCollapsed && "justify-center",
          isActive ? "text-brand" : "text-foreground/70 hover:text-foreground",
        )

        const link = item.external ? (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
            onMouseEnter={() => setHoveredHref(item.href)}
          >
            {inner}
          </a>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className={className}
            aria-current={isActive ? "page" : undefined}
            onMouseEnter={() => setHoveredHref(item.href)}
          >
            {inner}
          </Link>
        )

        if (isCollapsed) {
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger render={link} />
              <TooltipPopup>{item.label}</TooltipPopup>
            </Tooltip>
          )
        }

        return link
      })}
    </div>
  )
}
