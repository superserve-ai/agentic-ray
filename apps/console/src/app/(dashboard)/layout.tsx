import { ImpersonationBanner } from "@/components/admin/impersonation-banner"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import { QueryProvider } from "@/components/query-provider"
import { getImpersonationContext } from "@/lib/admin/impersonation"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const impersonationContext = await getImpersonationContext()
  const queryScope = impersonationContext?.teamId ?? "self"

  return (
    <QueryProvider cacheScope={queryScope}>
      <DashboardShell
        banner={<ImpersonationBanner context={impersonationContext} />}
      >
        {children}
      </DashboardShell>
    </QueryProvider>
  )
}
