"use client"

import type { SandboxResponse } from "@/lib/api/types"
import { formatTime, formatTimeout } from "@/lib/format"

interface SandboxResourceBarProps {
  sandbox: SandboxResponse
}

function formatMemory(mib: number): string {
  return mib >= 1024 ? `${(mib / 1024).toFixed(0)} GB` : `${mib} MB`
}

export function SandboxResourceBar({ sandbox }: SandboxResourceBarProps) {
  const created = formatTime(new Date(sandbox.created_at))

  const items: { label: string; value: string; title?: string }[] = [
    {
      label: "vCPU",
      value: String(sandbox.vcpu_count),
    },
    {
      label: "Memory",
      value: formatMemory(sandbox.memory_mib),
    },
    {
      label: "Timeout",
      value: sandbox.timeout_seconds
        ? formatTimeout(sandbox.timeout_seconds)
        : "None",
    },
    {
      label: "Snapshot",
      value: sandbox.snapshot_id
        ? `${sandbox.snapshot_id.slice(0, 8)}`
        : "None",
      title: sandbox.snapshot_id ?? undefined,
    },
    {
      label: "Created",
      value: created.relative,
      title: created.absolute,
    },
  ]

  return (
    <section className="flex h-10 items-center gap-6 border-b border-border bg-background px-4">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wider text-muted uppercase">
            {item.label}
          </span>
          <span
            className="font-mono text-xs text-foreground/80 tabular-nums"
            title={item.title}
          >
            {item.value}
          </span>
          {i < items.length - 1 && (
            <span className="ml-4 h-3 w-px bg-border" aria-hidden />
          )}
        </div>
      ))}
    </section>
  )
}
