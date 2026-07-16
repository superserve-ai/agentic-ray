"use client"

import { ArrowLeftIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"

import { ErrorState } from "@/components/error-state"
import { useQueryScope } from "@/components/query-provider"
import { ActivitySection } from "@/components/sandboxes/activity-section"
import { DeleteSandboxDialog } from "@/components/sandboxes/delete-sandbox-dialog"
import { FilesSection } from "@/components/sandboxes/files-section"
import { PreviewSection } from "@/components/sandboxes/preview-section"
import {
  MetadataSection,
  NetworkSection,
} from "@/components/sandboxes/sandbox-info-grid"
import { SandboxResourceBar } from "@/components/sandboxes/sandbox-resource-bar"
import { SandboxStatusHero } from "@/components/sandboxes/sandbox-status-hero"
import { NetworkLogTable } from "@/components/secrets/network-log-table"
import { SecretBindingList } from "@/components/secrets/secret-binding-list"
import { useSandboxNetwork } from "@/hooks/use-network"
import {
  useDeleteSandbox,
  usePauseSandbox,
  useResumeSandbox,
  useSandbox,
} from "@/hooks/use-sandboxes"
import { listActivityBySandboxAction } from "@/lib/api/activity-actions"
import { auditLogKeys } from "@/lib/api/query-keys"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex h-10 items-center border-b border-border px-4">
        <div className="h-3 w-24 animate-pulse bg-muted/20" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Status hero */}
        <div className="border-b border-border bg-foreground/[0.02] px-4 py-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-3">
              <div className="mt-2 size-2 shrink-0 animate-pulse bg-muted/40" />
              <div>
                <div className="h-6 w-48 animate-pulse bg-muted/30" />
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-3 w-12 animate-pulse bg-muted/20" />
                  <div className="h-3 w-16 animate-pulse bg-muted/20" />
                  <div className="h-3 w-24 animate-pulse bg-muted/20" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-24 animate-pulse bg-muted/20" />
              <div className="h-8 w-20 animate-pulse bg-muted/20" />
              <div className="size-8 animate-pulse bg-muted/20" />
            </div>
          </div>
        </div>

        {/* Resource bar */}
        <div className="flex h-10 items-center gap-6 border-b border-border px-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-2.5 w-12 animate-pulse bg-muted/20" />
              <div className="h-3 w-10 animate-pulse bg-muted/20" />
            </div>
          ))}
        </div>

        {/* Network | Metadata */}
        <div className="grid grid-cols-2 border-b border-border">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className={i === 0 ? "border-r border-border" : undefined}
            >
              <div className="flex h-10 items-center border-b border-border px-4">
                <div className="h-2.5 w-16 animate-pulse bg-muted/20" />
              </div>
              <div className="flex flex-wrap gap-1.5 px-4 py-4">
                <div className="h-6 w-28 animate-pulse bg-muted/20" />
                <div className="h-6 w-20 animate-pulse bg-muted/20" />
              </div>
            </div>
          ))}
        </div>

        {/* Files */}
        <div className="border-b border-border">
          <div className="flex h-10 items-center border-b border-border px-4">
            <div className="h-2.5 w-12 animate-pulse bg-muted/20" />
          </div>
          <div className="grid grid-cols-2">
            <div className="flex flex-col gap-3 border-r border-border px-4 py-4">
              <div className="h-3 w-16 animate-pulse bg-muted/20" />
              <div className="h-40 animate-pulse border border-dashed border-border" />
              <div className="h-9 animate-pulse bg-muted/20" />
              <div className="h-8 w-24 animate-pulse bg-muted/20" />
            </div>
            <div className="flex flex-col gap-3 px-4 py-4">
              <div className="h-3 w-20 animate-pulse bg-muted/20" />
              <div className="h-9 animate-pulse bg-muted/20" />
              <div className="h-8 w-28 animate-pulse bg-muted/20" />
            </div>
          </div>
        </div>

        {/* Activity */}
        <div className="flex h-10 items-center border-b border-border px-4">
          <div className="h-2.5 w-16 animate-pulse bg-muted/20" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`activity-${i}`}
            className="flex items-center gap-6 border-b border-border px-4 py-3"
          >
            <div className="h-3 w-24 animate-pulse bg-muted/20" />
            <div className="h-3 w-16 animate-pulse bg-muted/20" />
            <div className="h-3 w-20 animate-pulse bg-muted/20" />
            <div className="h-3 w-12 animate-pulse bg-muted/20" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SandboxDetailPage() {
  const params = useParams<{ sandbox_id: string }>()
  const router = useRouter()
  const posthog = usePostHog()
  const sandboxId = params.sandbox_id
  const queryScope = useQueryScope()

  const { data: sandbox, isPending, error, refetch } = useSandbox(sandboxId)
  const pauseMutation = usePauseSandbox()
  const resumeMutation = useResumeSandbox()
  const deleteMutation = useDeleteSandbox()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const network = useSandboxNetwork(sandboxId)

  const { data: activity, isPending: activityPending } = useQuery({
    queryKey: [...auditLogKeys.bySandbox(sandboxId), queryScope],
    queryFn: () => listActivityBySandboxAction(sandboxId),
    enabled: !!sandboxId,
    staleTime: 30_000,
  })

  // const { data: snapshots, isPending: snapshotsPending } = useQuery({
  //   queryKey: snapshotKeys.bySandbox(sandboxId),
  //   queryFn: () => listSnapshotsBySandboxAction(sandboxId),
  //   enabled: !!sandboxId,
  //   staleTime: 30_000,
  // })

  if (isPending) return <DetailSkeleton />

  if (error || !sandbox) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-10 items-center border-b border-border px-4">
          <Link
            href="/sandboxes/"
            className="flex items-center gap-1.5 font-mono text-xs text-muted uppercase hover:text-foreground"
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

  const handleDelete = async () => {
    posthog.capture(SANDBOX_EVENTS.DELETED, { id: sandbox.id })
    await new Promise<void>((resolve, reject) => {
      deleteMutation.mutate(sandbox.id, {
        onSuccess: () => {
          router.push("/sandboxes/")
          resolve()
        },
        onError: (err) => reject(err),
      })
    })
  }

  const handleStart = () => {
    posthog.capture(SANDBOX_EVENTS.RESUMED, { sandbox_id: sandbox.id })
    resumeMutation.mutate(sandbox.id)
  }

  const handleStop = () => {
    posthog.capture(SANDBOX_EVENTS.PAUSED, { sandbox_id: sandbox.id })
    pauseMutation.mutate(sandbox.id)
  }

  const handleOpenTerminal = () => {
    posthog.capture(SANDBOX_EVENTS.TERMINAL_OPENED, {
      sandbox_id: sandbox.id,
      source: "detail_hero",
    })
    router.push(`/sandboxes/${sandboxId}/terminal/`)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex h-10 shrink-0 items-center border-b border-border bg-background px-4">
        <Link
          href="/sandboxes/"
          className="flex items-center gap-1.5 font-mono text-xs text-muted uppercase hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" weight="light" />
          Sandboxes
        </Link>
      </div>

      <DeleteSandboxDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        isLoading={deleteMutation.isPending}
        sandboxName={sandbox.name}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Layer 1: status hero — most important, state-tinted */}
        <SandboxStatusHero
          sandbox={sandbox}
          onStart={handleStart}
          onStop={handleStop}
          onOpenTerminal={handleOpenTerminal}
          onDelete={() => setDeleteOpen(true)}
        />

        {/* Layer 2: compact resource summary */}
        <SandboxResourceBar sandbox={sandbox} />

        {/* Layer 3: configuration (read-mostly, edit on demand) */}
        <div className="grid grid-cols-2 border-b border-border">
          <div className="border-r border-border">
            <NetworkSection sandbox={sandbox} />
          </div>
          <MetadataSection sandbox={sandbox} />
        </div>

        {/* Layer 4: bound secrets */}
        <SecretBindingList
          sandboxId={sandbox.id}
          secrets={sandbox.secrets}
          status={sandbox.status}
        />

        {/* Layer 5: files (state-aware) */}
        <FilesSection sandbox={sandbox} onStart={handleStart} />

        {/* Layer 6: preview (state-aware) */}
        <PreviewSection sandbox={sandbox} onStart={handleStart} />

        {/* Layer 7: activity (history, lower priority) */}
        <ActivitySection activity={activity} isPending={activityPending} />

        {/* Layer 8: unified egress log (connections + secret requests) */}
        <NetworkLogTable
          title="Network"
          events={network.data?.data}
          isPending={network.isPending}
          hasMore={network.data?.has_more}
        />
      </div>
    </div>
  )
}
