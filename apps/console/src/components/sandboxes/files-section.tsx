"use client"

import { FilesIcon, PlayIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"

import type { SandboxResponse } from "@/lib/api/types"

import { FileBrowser } from "./files/file-browser"

function disabledReason(status: SandboxResponse["status"]): string {
  switch (status) {
    case "paused":
      return "Start the sandbox to browse files"
    case "resuming":
      return "Sandbox is resuming"
    default:
      return "Files unavailable"
  }
}

interface FilesSectionProps {
  sandbox: SandboxResponse
  onStart?: () => void
}

export function FilesSection({ sandbox, onStart }: FilesSectionProps) {
  const isActive = sandbox.status === "active"

  return (
    <section className="border-b border-border">
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Files</h2>
      </div>
      {isActive ? (
        <FileBrowser sandbox={sandbox} />
      ) : (
        <FilesEmptyState status={sandbox.status} onStart={onStart} />
      )}
    </section>
  )
}

function FilesEmptyState({
  status,
  onStart,
}: {
  status: SandboxResponse["status"]
  onStart?: () => void
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-4 px-6 py-12">
      <FilesIcon className="size-8 text-muted" weight="light" />
      <div className="flex flex-col items-center gap-1.5">
        <p className="font-mono text-sm text-foreground/60">
          {disabledReason(status)}
        </p>
        {status === "paused" && onStart && (
          <Button size="sm" onClick={onStart} className="mt-3">
            <PlayIcon className="size-3.5" weight="light" />
            Start sandbox
          </Button>
        )}
      </div>
    </div>
  )
}
