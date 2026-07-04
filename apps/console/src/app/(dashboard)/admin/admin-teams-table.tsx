import { UsersIcon } from "@phosphor-icons/react/dist/ssr"
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"

import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import type { AdminTeamRow } from "@/lib/admin/teams-actions"
import { formatDate } from "@/lib/format"

interface AdminTeamsTableProps {
  teams: AdminTeamRow[]
  onActAs: (teamId: string) => Promise<void>
}

export function AdminTeamsTable({ teams, onActAs }: AdminTeamsTableProps) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Admin" />

      {teams.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No Teams"
          description="No teams have been created yet."
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
              <TableRow>
                <TableHead className="w-[35%]">Team</TableHead>
                <TableHead className="w-[20%]">Sandboxes</TableHead>
                <TableHead className="w-[25%]">Created</TableHead>
                <TableHead className="w-[20%]" />
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell className="font-medium">{team.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted tabular-nums">
                    {team.active_sandbox_count} / {team.max_sandboxes}
                  </TableCell>
                  <TableCell className="text-muted tabular-nums">
                    {team.created_at
                      ? formatDate(new Date(team.created_at))
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={onActAs.bind(null, team.id)}>
                      <button
                        type="submit"
                        className="inline-flex h-8 items-center justify-center border border-dashed border-border px-3 font-mono text-xs text-foreground uppercase transition-colors hover:bg-muted/30"
                      >
                        Act as
                      </button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </StickyHoverTableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
