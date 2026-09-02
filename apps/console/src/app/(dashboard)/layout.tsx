import { ImpersonationBanner } from "@/components/admin/impersonation-banner"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import { QueryProvider } from "@/components/query-provider"
import {
  getImpersonationContext,
  hasImpersonationCookie,
} from "@/lib/admin/impersonation"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const impersonationContext = (await hasImpersonationCookie())
    ? await getImpersonationContext()
    : null
  const queryScope = impersonationContext?.teamId ?? "self"

  return (
    <QueryProvider
      cacheScope={queryScope}
      teamContext={
        impersonationContext
          ? {
              teamId: impersonationContext.teamId,
              region: impersonationContext.region,
              name: impersonationContext.teamName,
            }
          : null
      }
    >
      <DashboardShell
        banner={<ImpersonationBanner context={impersonationContext} />}
      >
        {children}
      </DashboardShell>
    </QueryProvider>
  )
}
