"use client"

import { ArrowLeftIcon } from "@phosphor-icons/react"
import { cn } from "@superserve/ui"
import Link from "next/link"

import { ErrorState } from "@/components/error-state"
import { usePlatformTeamSandbox } from "@/hooks/use-platform-sandboxes"
import { formatMemory, formatTime, formatTimeout } from "@/lib/format"

const STATUS_CONFIG = {
  active: {
    label: "Active",
    bg: "bg-brand/[0.05]",
    dot: "bg-brand",
    pulse: true,
  },
  paused: {
    label: "Paused",
    bg: "bg-foreground/[0.02]",
    dot: "bg-muted",
    pulse: false,
  },
  resuming: {
    label: "Resuming",
    bg: "bg-warning/[0.04]",
    dot: "bg-warning",
    pulse: true,
  },
  failed: {
    label: "Failed",
    bg: "bg-destructive/[0.04]",
    dot: "bg-destructive",
    pulse: false,
  },
} as const

function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center border-b border-border px-4">
        <div className="h-3 w-40 animate-pulse bg-muted/20" />
      </div>
      <div className="border-b border-border bg-foreground/[0.02] px-4 py-6">
        <div className="h-6 w-48 animate-pulse bg-muted/30" />
        <div className="mt-2 h-3 w-64 animate-pulse bg-muted/20" />
      </div>
      <div className="grid grid-cols-2 border-b border-border">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className={i === 0 ? "border-r border-border" : undefined}
          >
            <div className="flex h-10 items-center border-b border-border px-4">
              <div className="h-2.5 w-16 animate-pulse bg-muted/20" />
            </div>
            <div className="space-y-3 px-4 py-4">
              <div className="h-3 w-40 animate-pulse bg-muted/20" />
              <div className="h-3 w-28 animate-pulse bg-muted/20" />
              <div className="h-3 w-32 animate-pulse bg-muted/20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function KeyValueGrid({
  rows,
}: {
  rows: Array<{ label: string; value: string }>
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-4 text-sm text-foreground/40">None</p>
  }

  return (
    <div className="space-y-3 px-4 py-4">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[140px_1fr] gap-4">
          <span className="font-mono text-[11px] tracking-wider text-muted uppercase">
            {row.label}
          </span>
          <span className="font-mono text-xs break-all text-foreground/80">
            {row.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export function AdminSandboxDetailClient({
  teamId,
  teamName,
  sandboxId,
}: {
  teamId: string
  teamName: string
  sandboxId: string
}) {
  const {
    data: sandbox,
    isPending,
    error,
    refetch,
  } = usePlatformTeamSandbox(teamId, sandboxId)

  if (isPending) return <DetailSkeleton />

  if (error || !sandbox) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-10 items-center border-b border-border px-4">
          <Link
            href={`/admin/teams/${teamId}/`}
            className="flex items-center gap-1.5 font-mono text-xs text-muted uppercase hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            {teamName}
          </Link>
        </div>
        <ErrorState
          message={error?.message ?? "Sandbox not found"}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const cfg =
    STATUS_CONFIG[sandbox.status as keyof typeof STATUS_CONFIG] ??
    STATUS_CONFIG.paused
  const created = formatTime(new Date(sandbox.created_at))
  const networkRows = [
    ...(sandbox.network?.allow_out?.map((rule) => ({
      label: "Allow",
      value: rule,
    })) ?? []),
    ...(sandbox.network?.deny_out?.map((rule) => ({
      label: "Deny",
      value: rule,
    })) ?? []),
  ]
  const metadataRows = Object.entries(sandbox.metadata ?? {}).map(
    ([label, value]) => ({
      label,
      value,
    }),
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-border bg-background px-4">
        <Link
          href={`/admin/teams/${teamId}/`}
          className="flex items-center gap-1.5 font-mono text-xs text-muted uppercase hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" weight="light" />
          {teamName}
        </Link>
      </div>

      <div className="border-b border-dashed border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs tracking-tight text-warning uppercase">
        Read-only sandbox view via platform:sandbox:read
      </div>

      <section className={cn("border-b border-border px-4 py-6", cfg.bg)}>
        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "relative mt-2 inline-flex size-2 shrink-0",
                cfg.dot,
              )}
            >
              {cfg.pulse && (
                <span
                  className={cn(
                    "absolute inline-flex size-full animate-ping rounded-full opacity-75",
                    cfg.dot,
                  )}
                />
              )}
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-mono text-xl font-medium text-foreground">
                {sandbox.name}
              </h1>
              <div className="mt-1.5 flex items-center gap-2 font-mono text-xs text-muted uppercase">
                <span className="text-foreground/80">{cfg.label}</span>
                <span>·</span>
                <span title={sandbox.id}>{sandbox.id.slice(0, 8)}</span>
                <span>·</span>
                <span title={created.absolute}>Created {created.relative}</span>
              </div>
            </div>
          </div>
          <span className="font-mono text-xs text-muted uppercase">
            Read-only
          </span>
        </div>
      </section>

      <section className="flex h-10 items-center gap-6 border-b border-border bg-background px-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wider text-muted uppercase">
            vCPU
          </span>
          <span className="font-mono text-xs text-foreground/80">
            {sandbox.vcpu_count}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wider text-muted uppercase">
            Memory
          </span>
          <span className="font-mono text-xs text-foreground/80">
            {formatMemory(sandbox.memory_mib)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wider text-muted uppercase">
            Timeout
          </span>
          <span className="font-mono text-xs text-foreground/80">
            {formatTimeout(sandbox.timeout_seconds)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wider text-muted uppercase">
            Snapshot
          </span>
          <span className="font-mono text-xs text-foreground/80">
            {sandbox.snapshot_id ? sandbox.snapshot_id.slice(0, 8) : "None"}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-2 border-b border-border">
        <div className="border-r border-border">
          <div className="flex h-10 items-center border-b border-border px-4">
            <h2 className="text-sm font-semibold text-foreground">Network</h2>
          </div>
          <KeyValueGrid rows={networkRows} />
        </div>
        <div>
          <div className="flex h-10 items-center border-b border-border px-4">
            <h2 className="text-sm font-semibold text-foreground">Metadata</h2>
          </div>
          <KeyValueGrid rows={metadataRows} />
        </div>
      </div>
    </div>
  )
}
