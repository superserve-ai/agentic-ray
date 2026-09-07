"use client"

import { ArrowLeftIcon, CubeIcon } from "@phosphor-icons/react"
import {
  Badge,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { usePlatformTeamSandboxes } from "@/hooks/use-platform-sandboxes"
import type { PlatformSandboxRead } from "@/lib/api/platform-sandboxes"
import { formatMemory } from "@/lib/format"
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "@/lib/sandbox-utils"

function ReadOnlyBadge() {
  return (
    <span className="font-mono text-xs tracking-wide text-muted uppercase">
      Read-only
    </span>
  )
}

function statusVariant(status: string) {
  return (
    STATUS_BADGE_VARIANT[status as keyof typeof STATUS_BADGE_VARIANT] ?? "muted"
  )
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status
}

function SandboxRow({
  teamId,
  sandbox,
}: {
  teamId: string
  sandbox: PlatformSandboxRead
}) {
  const href = `/admin/teams/${teamId}/sandboxes/${sandbox.id}/`

  return (
    <TableRow>
      <TableCell className="font-mono text-foreground/80">
        <Link href={href} className="hover:underline">
          {sandbox.name}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant(sandbox.status)} dot>
          {statusLabel(sandbox.status)}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted tabular-nums">
        {sandbox.vcpu_count}CPU | {formatMemory(sandbox.memory_mib)}
      </TableCell>
      <TableCell className="text-right">
        <ReadOnlyBadge />
      </TableCell>
    </TableRow>
  )
}

export function TeamSandboxesClient({
  teamId,
  teamName,
}: {
  teamId: string
  teamName: string
}) {
  const {
    data: sandboxes = [],
    isPending,
    error,
    refetch,
  } = usePlatformTeamSandboxes(teamId)

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={`Admin — ${teamName}`}>
        <Link
          href="/admin"
          className="flex items-center gap-1.5 font-mono text-xs text-muted uppercase hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" weight="light" />
          Teams
        </Link>
      </PageHeader>

      <div className="border-b border-dashed border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs tracking-tight text-warning uppercase">
        Viewing sandbox inventory for {teamName}
      </div>

      {isPending ? (
        <TableSkeleton columns={4} />
      ) : error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : sandboxes.length === 0 ? (
        <EmptyState
          icon={CubeIcon}
          title="No Sandboxes"
          description="This team does not have any sandboxes."
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
              <TableRow>
                <TableHead className="w-[40%]">Name</TableHead>
                <TableHead className="w-[20%]">Status</TableHead>
                <TableHead className="w-[20%]">Resources</TableHead>
                <TableHead className="w-[20%]" />
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {sandboxes.map((sandbox) => (
                <SandboxRow
                  key={sandbox.id}
                  teamId={teamId}
                  sandbox={sandbox}
                />
              ))}
            </StickyHoverTableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
