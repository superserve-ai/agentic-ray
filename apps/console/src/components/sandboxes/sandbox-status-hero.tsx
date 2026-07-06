"use client"

import {
  DotsThreeVerticalIcon,
  PlayIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Button,
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@superserve/ui"

import type { SandboxResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"

interface SandboxStatusHeroProps {
  sandbox: SandboxResponse
  onStart: () => void
  onStop: () => void
  onOpenTerminal: () => void
  onDelete: () => void
}

const STATUS_CONFIG: Record<
  SandboxResponse["status"],
  {
    label: string
    bg: string
    dot: string
    pulse: boolean
  }
> = {
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
}

export function SandboxStatusHero({
  sandbox,
  onStart,
  onStop,
  onOpenTerminal,
  onDelete,
}: SandboxStatusHeroProps) {
  const cfg = STATUS_CONFIG[sandbox.status]
  const created = formatTime(new Date(sandbox.created_at))

  return (
    <section className={cn("border-b border-border px-4 py-6", cfg.bg)}>
      <div className="flex items-start justify-between gap-6">
        {/* Identity + status */}
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn("relative mt-2 inline-flex size-2 shrink-0", cfg.dot)}
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

        {/* State-aware actions */}
        <SandboxActions
          status={sandbox.status}
          onStart={onStart}
          onStop={onStop}
          onOpenTerminal={onOpenTerminal}
          onDelete={onDelete}
        />
      </div>
    </section>
  )
}

interface SandboxActionsProps {
  status: SandboxResponse["status"]
  onStart: () => void
  onStop: () => void
  onOpenTerminal: () => void
  onDelete: () => void
}

function SandboxActions({
  status,
  onStart,
  onStop,
  onOpenTerminal,
  onDelete,
}: SandboxActionsProps) {
  // Inapplicable actions are removed entirely (not greyed). What's
  // visible always reflects what you can do.
  if (status === "active") {
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onOpenTerminal}>
          <TerminalIcon className="size-3.5" weight="light" />
          Terminal
        </Button>
        <Button variant="outline" size="sm" onClick={onStop}>
          <StopIcon className="size-3.5" weight="light" />
          Stop
        </Button>
        <ActionsMenu onDelete={onDelete} />
      </div>
    )
  }

  if (status === "paused") {
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onStart}>
          <PlayIcon className="size-3.5" weight="light" />
          Start
        </Button>
        <ActionsMenu onDelete={onDelete} />
      </div>
    )
  }

  if (status === "resuming") {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted uppercase">
          Resuming…
        </span>
        <ActionsMenu onDelete={onDelete} />
      </div>
    )
  }

  // failed
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <TrashIcon className="size-3.5" weight="light" />
        Delete
      </Button>
    </div>
  )
}

function ActionsMenu({ onDelete }: { onDelete: () => void }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="More actions" />
        }
      >
        <DotsThreeVerticalIcon className="size-4" weight="bold" />
      </MenuTrigger>
      <MenuPopup>
        <MenuItem
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <TrashIcon className="size-4" weight="light" />
          Delete sandbox
        </MenuItem>
      </MenuPopup>
    </Menu>
  )
}
