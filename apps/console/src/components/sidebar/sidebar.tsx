"use client"

import { MagnifyingGlassIcon, SidebarSimpleIcon } from "@phosphor-icons/react"
import {
  Button,
  cn,
  Kbd,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@superserve/ui"
import Image from "next/image"

import { useUser } from "@/hooks/use-user"
import { canViewOtherUsersAccount } from "@/lib/admin/permissions"

import {
  bottomNavItems,
  mainNavItems,
  userManagementNavItem,
} from "./nav-config"
import { useSidebar } from "./sidebar-context"
import { SidebarNav } from "./sidebar-nav"
import { SidebarUserMenu } from "./sidebar-user-menu"

function openCommandPalette() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true }),
  )
}

export function Sidebar() {
  const { isCollapsed, toggle } = useSidebar()
  const { user } = useUser()
  const navItems = [
    ...mainNavItems,
    ...(canViewOtherUsersAccount(user) ? [userManagementNavItem] : []),
  ]

  return (
    <aside
      className={cn(
        "absolute top-0 left-0 z-40 flex h-full flex-col border-r border-border bg-background/80 backdrop-blur-sm transition-all duration-200",
        isCollapsed ? "w-16" : "w-64",
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-center p-5">
        {isCollapsed ? (
          <Image
            src="/logo-mark.svg"
            alt="Superserve"
            width={20}
            height={20}
            className="size-5"
          />
        ) : (
          <Image
            src="/logo.svg"
            alt="Superserve"
            width={100}
            height={20}
            className="h-5 w-auto"
          />
        )}
      </div>

      {/* Search */}
      <div className="mb-2 px-2.5">
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={openCommandPalette}
                  aria-label="Search"
                  className="w-full"
                />
              }
            >
              <MagnifyingGlassIcon className="size-4" weight="light" />
            </TooltipTrigger>
            <TooltipPopup>Search</TooltipPopup>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={openCommandPalette}
            className="group flex w-full cursor-pointer items-center gap-2.5 border border-border px-2.5 py-2.5 text-foreground/70 transition-colors hover:bg-brand/10 hover:text-foreground"
          >
            <MagnifyingGlassIcon className="size-4 shrink-0" weight="light" />
            <span className="flex-1 text-left text-sm leading-none tracking-tight text-foreground/70">
              Search
            </span>
            <div className="flex items-center gap-0.5">
              <Kbd className="transition-colors group-hover:bg-neutral-900">
                &#8984;
              </Kbd>
              <Kbd className="transition-colors group-hover:bg-neutral-900">
                K
              </Kbd>
            </div>
          </button>
        )}
      </div>

      {/* Main Nav */}
      <SidebarNav items={navItems} groupId="main" />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Collapse Toggle */}
      <nav className="mb-0.5 px-2.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={toggle}
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2.5 text-foreground/70 transition-colors hover:bg-brand/10 hover:text-foreground",
                  isCollapsed && "justify-center",
                )}
              />
            }
          >
            <SidebarSimpleIcon className="size-4 shrink-0" weight="light" />
            {!isCollapsed && (
              <span className="text-sm leading-none tracking-tight">
                Collapse
              </span>
            )}
          </TooltipTrigger>
          {isCollapsed && <TooltipPopup>Expand</TooltipPopup>}
        </Tooltip>
      </nav>

      {/* Bottom Nav */}
      <SidebarNav items={bottomNavItems} groupId="bottom" />

      <div className="m-2.5 border-t border-border" />

      {/* User Menu */}
      <div className="pb-2.5">
        <SidebarUserMenu />
      </div>
    </aside>
  )
}
