import { ClipboardTextIcon } from "@phosphor-icons/react"
import {
  Badge,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@superserve/ui"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import type { ActivityResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"
import { ACTIVITY_STATUS_VARIANT, formatDuration } from "@/lib/sandbox-utils"

interface ActivitySectionProps {
  activity: ActivityResponse[] | undefined
  isPending: boolean
  error: Error | null
  onRetry?: () => void
}

export function ActivitySection({
  activity,
  isPending,
  error,
  onRetry,
}: ActivitySectionProps) {
  return (
    <>
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
      </div>
      {isPending ? (
        <div className="border-b border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-6 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="h-3 w-24 animate-pulse bg-muted/20" />
              <div className="h-3 w-16 animate-pulse bg-muted/20" />
              <div className="h-3 w-20 animate-pulse bg-muted/20" />
              <div className="h-3 w-12 animate-pulse bg-muted/20" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="border-b border-border">
          <ErrorState
            title="Unable to load activity"
            message={error.message}
            onRetry={onRetry}
          />
        </div>
      ) : !activity || activity.length === 0 ? (
        <div className="border-b border-border py-10">
          <EmptyState
            icon={ClipboardTextIcon}
            title="No Activity"
            description="Activity will appear here when you run commands or change sandbox state."
          />
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto border-b border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[22%]">Time</TableHead>
                <TableHead className="w-[15%]">Category</TableHead>
                <TableHead className="w-[20%]">Action</TableHead>
                <TableHead className="w-[12%]">Duration</TableHead>
                <TableHead className="w-[12%]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {activity.map((entry) => {
                const { relative, absolute } = formatTime(
                  new Date(entry.created_at),
                )
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <span className="text-foreground/80">{relative}</span>
                      <span className="ml-2 text-xs text-muted">
                        {absolute}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted capitalize">
                      {entry.category}
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {entry.action}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted tabular-nums">
                      {formatDuration(entry.duration_ms)}
                    </TableCell>
                    <TableCell>
                      {entry.status ? (
                        entry.error ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Badge
                                  variant={
                                    ACTIVITY_STATUS_VARIANT[entry.status] ??
                                    "muted"
                                  }
                                  dot
                                  className="cursor-default"
                                />
                              }
                            >
                              {entry.status}
                            </TooltipTrigger>
                            <TooltipPopup className="max-w-xs text-xs">
                              {entry.error}
                            </TooltipPopup>
                          </Tooltip>
                        ) : (
                          <Badge
                            variant={
                              ACTIVITY_STATUS_VARIANT[entry.status] ?? "muted"
                            }
                            dot
                          >
                            {entry.status}
                          </Badge>
                        )
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </StickyHoverTableBody>
          </Table>
        </div>
      )}
    </>
  )
}
