"use client"

import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  RocketLaunchIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"

import { ErrorState } from "@/components/error-state"
import { BuildHistorySection } from "@/components/templates/build-history-section"
import { CurrentBuildPanel } from "@/components/templates/current-build-panel"
import { DeleteTemplateDialog } from "@/components/templates/delete-template-dialog"
import { TemplateDetailSkeleton } from "@/components/templates/template-detail-skeleton"
import { TemplateInfoGrid } from "@/components/templates/template-info-grid"
import { TemplateStatusBadge } from "@/components/templates/template-status-badge"
import { useRebuildTemplate, useTemplate } from "@/hooks/use-templates"
import { isSystemTemplate } from "@/lib/templates/is-system-template"

export default function TemplateDetailPageClient() {
  const params = useParams<{ template_id: string }>()
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { data, isPending, error, refetch } = useTemplate(
    params?.template_id ?? null,
  )
  const rebuild = useRebuildTemplate()

  if (isPending) return <TemplateDetailSkeleton />

  if (error || !data) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border px-6">
          <Link
            href="/templates/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            Templates
          </Link>
        </div>
        <ErrorState
          message={error?.message ?? "Template not found"}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const system = isSystemTemplate(data)
  const rebuildDisabled =
    rebuild.isPending || data.status === "building" || data.status === "pending"

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/templates/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            Templates
          </Link>
          <span className="text-muted">/</span>
          <h1 className="font-mono text-sm font-medium text-foreground">
            {data.name}
          </h1>
          <TemplateStatusBadge status={data.status} />
          {system && (
            <span className="font-mono text-[10px] text-muted uppercase">
              System
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={data.status !== "ready"}
            onClick={() =>
              router.push(
                `/sandboxes?from_template=${encodeURIComponent(data.name)}`,
              )
            }
          >
            <RocketLaunchIcon className="size-3.5" weight="light" />
            Launch sandbox
          </Button>
          {!system && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => rebuild.mutate(data.id)}
              disabled={rebuildDisabled}
            >
              <ArrowsClockwiseIcon className="size-3.5" weight="light" />
              Rebuild
            </Button>
          )}
          {!system && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <TrashIcon className="size-3.5" weight="light" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <DeleteTemplateDialog
        template={data}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => router.push("/templates/")}
      />

      <div className="flex-1 overflow-y-auto">
        <TemplateInfoGrid template={data} />
        {!system && (
          <>
            <CurrentBuildPanel templateId={data.id} />
            <BuildHistorySection templateId={data.id} />
          </>
        )}
      </div>
    </div>
  )
}
