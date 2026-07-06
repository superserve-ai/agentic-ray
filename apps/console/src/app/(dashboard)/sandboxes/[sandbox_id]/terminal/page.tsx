"use client"

import { ArrowLeftIcon, PlayIcon, TerminalIcon } from "@phosphor-icons/react"
import { Badge, Button } from "@superserve/ui"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { TerminalTabs } from "@/components/sandboxes/terminal-tabs"
import { useResumeSandbox, useSandbox } from "@/hooks/use-sandboxes"
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "@/lib/sandbox-utils"

function TerminalSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-border px-6">
        <div className="h-4 w-24 animate-pulse bg-muted/20" />
        <span className="text-muted">/</span>
        <div className="h-4 w-32 animate-pulse bg-muted/20" />
        <span className="text-muted">/</span>
        <div className="h-4 w-20 animate-pulse bg-muted/20" />
      </div>
      <div className="flex-1 bg-background" />
    </div>
  )
}

export default function TerminalPage() {
  const params = useParams<{ sandbox_id: string }>()
  const sandboxId = params.sandbox_id

  const router = useRouter()
  const { data: sandbox, isPending, error, refetch } = useSandbox(sandboxId)
  const resumeMutation = useResumeSandbox()

  if (isPending) return <TerminalSkeleton />

  if (error || !sandbox) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border px-6">
          <Link
            href="/sandboxes/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            Sandboxes
          </Link>
        </div>
        <ErrorState
          message={error?.message ?? "Sandbox not found"}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const canRun = sandbox.status === "active"

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/70 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
          </button>
          <Link
            href="/sandboxes/"
            className="text-sm text-muted hover:text-foreground"
          >
            Sandboxes
          </Link>
          <span className="text-muted">/</span>
          <Link
            href={`/sandboxes/${sandboxId}/`}
            className="font-mono text-sm text-muted hover:text-foreground"
          >
            {sandbox.name}
          </Link>
          <span className="text-muted">/</span>
          <h1 className="text-sm font-medium text-foreground">Terminal</h1>
          <Badge variant={STATUS_BADGE_VARIANT[sandbox.status]} dot>
            {STATUS_LABEL[sandbox.status]}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {sandbox.status === "paused" && (
            <Button size="sm" onClick={() => resumeMutation.mutate(sandbox.id)}>
              <PlayIcon className="size-3.5" weight="light" />
              Start
            </Button>
          )}
          {sandbox.status === "resuming" && (
            <span className="font-mono text-xs text-muted uppercase">
              Resuming…
            </span>
          )}
        </div>
      </div>

      {canRun ? (
        <TerminalTabs
          sandboxId={sandboxId}
          accessToken={sandbox.access_token}
        />
      ) : sandbox.status === "paused" ? (
        <EmptyState
          icon={TerminalIcon}
          title="Sandbox is paused"
          description="Start the sandbox to open a terminal session. Resume takes a second or two."
          actionLabel={resumeMutation.isPending ? "Starting…" : "Start sandbox"}
          onAction={() => resumeMutation.mutate(sandbox.id)}
        />
      ) : sandbox.status === "resuming" ? (
        <EmptyState
          icon={TerminalIcon}
          title="Resuming…"
          description="Sandbox is starting up. The terminal will be ready in a moment."
        />
      ) : (
        <ErrorState
          message="Sandbox is not running."
          suggestion="Go back to the sandbox details to manage it."
        />
      )}
    </div>
  )
}
