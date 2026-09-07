"use client"

import { CameraIcon, DotsThreeVerticalIcon } from "@phosphor-icons/react"
import {
  Badge,
  Button,
  Checkbox,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useMemo, useState } from "react"

import { AnimatedTableRow } from "@/components/animated-table-row"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { useSelection } from "@/hooks/use-selection"
import { useSnapshots } from "@/hooks/use-snapshots"
import { formatDate } from "@/lib/format"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

const TRIGGER_LABEL: Record<string, string> = {
  pause: "Pause",
  manual: "Manual",
}

export default function SnapshotsPage() {
  const { data: snapshots, isPending, error, refetch } = useSnapshots()
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!snapshots) return []
    if (!search) return snapshots
    const q = search.toLowerCase()
    return snapshots.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.sandbox_id.toLowerCase().includes(q),
    )
  }, [snapshots, search])

  const { selected, allSelected, someSelected, toggleAll, toggleOne } =
    useSelection(filtered)

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Snapshots" />
        <TableSkeleton columns={6} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Snapshots" />
        <ErrorState onRetry={() => refetch()} />
      </div>
    )
  }

  const isEmpty = snapshots.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Snapshots" />

      {isEmpty ? (
        <EmptyState
          icon={CameraIcon}
          title="No Snapshots"
          description="Snapshots are created when you pause a sandbox to preserve its state."
        />
      ) : (
        <>
          <TableToolbar
            searchPlaceholder="Search snapshots..."
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all snapshots"
                    />
                  </TableHead>
                  <TableHead className="w-[30%]">Name</TableHead>
                  <TableHead className="w-[15%]">Size</TableHead>
                  <TableHead className="w-[15%]">Trigger</TableHead>
                  <TableHead className="w-[10%]">Saved</TableHead>
                  <TableHead className="w-[18%]">Created</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((snapshot) => (
                  <AnimatedTableRow key={snapshot.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(snapshot.id)}
                        onCheckedChange={() => toggleOne(snapshot.id)}
                        aria-label={`Select ${snapshot.name ?? snapshot.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-foreground/80">
                      {snapshot.name ?? `${snapshot.sandbox_id.slice(0, 8)}...`}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted tabular-nums">
                      {formatBytes(snapshot.size_bytes)}
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {TRIGGER_LABEL[snapshot.trigger] ?? snapshot.trigger}
                    </TableCell>
                    <TableCell>
                      <Badge variant={snapshot.saved ? "success" : "muted"} dot>
                        {snapshot.saved ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted tabular-nums">
                      {formatDate(new Date(snapshot.created_at))}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Snapshot actions"
                      >
                        <DotsThreeVerticalIcon
                          className="size-4"
                          weight="bold"
                        />
                      </Button>
                    </TableCell>
                  </AnimatedTableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
