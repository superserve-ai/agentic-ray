"use client"

import { cn, TooltipProvider } from "@superserve/ui"

import {
  type ImpersonationState,
  ImpersonationStateProvider,
} from "@/components/admin/impersonation-context"
import { CommandPalette } from "@/components/command-palette"
import { QuotaWarningBanner } from "@/components/quota/quota-warning-banner"
import { Sidebar } from "@/components/sidebar/sidebar"
import {
  SidebarProvider,
  useSidebar,
} from "@/components/sidebar/sidebar-context"
import { useFaviconStatus } from "@/hooks/use-favicon-status"
import { usePostHogIdentify } from "@/hooks/use-posthog-identify"

interface DashboardContentProps {
  children: React.ReactNode
  isStaff: boolean
  banner?: React.ReactNode
}

function DashboardContent({
  children,
  isStaff,
  banner,
}: DashboardContentProps) {
  const { isCollapsed } = useSidebar()
  usePostHogIdentify()
  useFaviconStatus()

  return (
    <div className="flex h-screen flex-col">
      {banner}
      <div className="relative flex min-h-0 flex-1">
        <Sidebar isStaff={isStaff} />
        <CommandPalette />
        <main
          className={cn(
            "flex flex-1 flex-col overflow-hidden transition-all duration-200",
            isCollapsed ? "ml-16" : "ml-64",
          )}
        >
          <QuotaWarningBanner />
          {/* Owns the height left after the banner so full-height (h-full) pages
              measure the remaining space instead of overflowing the clipped main. */}
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </main>
      </div>
    </div>
  )
}

interface DashboardShellProps {
  children: React.ReactNode
  isStaff: boolean
  impersonation: ImpersonationState
  banner?: React.ReactNode
}

export function DashboardShell({
  children,
  isStaff,
  impersonation,
  banner,
}: DashboardShellProps) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <ImpersonationStateProvider value={impersonation}>
          <DashboardContent isStaff={isStaff} banner={banner}>
            {children}
          </DashboardContent>
        </ImpersonationStateProvider>
      </TooltipProvider>
    </SidebarProvider>
  )
}
