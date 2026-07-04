import {
  getImpersonationContext,
  type ImpersonationContext,
} from "@/lib/admin/impersonation"
import { stopImpersonationAction } from "@/lib/admin/teams-actions"

export async function ImpersonationBanner({
  context,
}: {
  context?: ImpersonationContext | null
} = {}) {
  const ctx = context === undefined ? await getImpersonationContext() : context

  if (!ctx) return null

  return (
    <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-dashed border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs leading-none tracking-tight text-warning uppercase">
      <span className="min-w-0 truncate" title={ctx.teamName}>
        Read-only — viewing team {ctx.teamName}
      </span>
      <form action={stopImpersonationAction}>
        <button type="submit" className="underline">
          Exit
        </button>
      </form>
    </div>
  )
}
