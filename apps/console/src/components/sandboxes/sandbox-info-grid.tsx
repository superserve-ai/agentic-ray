"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Button, Input } from "@superserve/ui"
import { useState } from "react"

import { usePatchSandbox } from "@/hooks/use-sandboxes"
import type { SandboxResponse } from "@/lib/api/types"
import { formatDate, formatTime, formatTimeout } from "@/lib/format"

interface SandboxInfoGridProps {
  sandbox: SandboxResponse
}

/** Human label for a sandbox's auto-delete state. */
function formatAutoDelete(sandbox: SandboxResponse): string {
  if (sandbox.auto_delete_at) {
    return formatTime(new Date(sandbox.auto_delete_at)).absolute
  }
  if (sandbox.auto_delete_seconds == null) return "None"
  if (sandbox.auto_delete_seconds === 0) return "On pause"
  return `${formatTimeout(sandbox.auto_delete_seconds)} after pause`
}

export function NetworkSection({ sandbox }: { sandbox: SandboxResponse }) {
  const patchMutation = usePatchSandbox()
  const [editing, setEditing] = useState(false)
  const [allowRules, setAllowRules] = useState<string[]>([])
  const [denyRules, setDenyRules] = useState<string[]>([])

  const currentAllow = sandbox.network?.allow_out ?? []
  const currentDeny = sandbox.network?.deny_out ?? []
  const hasRules = currentAllow.length > 0 || currentDeny.length > 0

  const startEdit = () => {
    setAllowRules([...currentAllow])
    setDenyRules([...currentDeny])
    setEditing(true)
  }

  const handleSave = () => {
    const allow = allowRules.map((r) => r.trim()).filter(Boolean)
    const deny = denyRules.map((r) => r.trim()).filter(Boolean)
    patchMutation.mutate(
      {
        id: sandbox.id,
        data: {
          network: {
            allow_out: allow,
            deny_out: deny,
          },
        },
      },
      { onSuccess: () => setEditing(false) },
    )
  }

  if (editing) {
    return (
      <div>
        <div className="flex h-10 items-center justify-between px-4">
          <h2 className="text-sm font-semibold text-foreground">Network</h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={patchMutation.isPending}
            >
              {patchMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2">
            <span className="pt-1.5 text-xs text-muted">
              Allow — domains or CIDRs
            </span>
            <div className="space-y-2">
              {allowRules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="api.openai.com"
                    value={rule}
                    onChange={(e) => {
                      const updated = [...allowRules]
                      updated[i] = e.target.value
                      setAllowRules(updated)
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    onClick={() =>
                      setAllowRules(allowRules.filter((_, j) => j !== i))
                    }
                  >
                    <TrashIcon className="size-3.5 text-muted" weight="light" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setAllowRules([...allowRules, ""])}
              >
                <PlusIcon className="size-3.5" weight="light" />
                Add
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2">
            <span className="pt-1.5 text-xs text-muted">Deny — CIDRs</span>
            <div className="space-y-2">
              {denyRules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="0.0.0.0/0"
                    value={rule}
                    onChange={(e) => {
                      const updated = [...denyRules]
                      updated[i] = e.target.value
                      setDenyRules(updated)
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    onClick={() =>
                      setDenyRules(denyRules.filter((_, j) => j !== i))
                    }
                  >
                    <TrashIcon className="size-3.5 text-muted" weight="light" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setDenyRules([...denyRules, ""])}
              >
                <PlusIcon className="size-3.5" weight="light" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex h-10 items-center justify-between px-4">
        <h2 className="text-sm font-semibold text-foreground">Network</h2>
        <Button variant="ghost" size="icon-sm" onClick={startEdit}>
          <PencilSimpleIcon className="size-3.5 text-muted" weight="light" />
        </Button>
      </div>
      {hasRules ? (
        <div className="space-y-2 px-4 py-4">
          {currentAllow.length > 0 && (
            <div className="flex items-start gap-2">
              <ArrowUpIcon
                className="mt-0.5 size-3.5 shrink-0 text-success"
                weight="light"
              />
              <div className="flex flex-wrap gap-1.5">
                {currentAllow.map((rule) => (
                  <span
                    key={rule}
                    className="border border-dashed border-border px-2 py-0.5 font-mono text-xs text-foreground/80"
                  >
                    {rule}
                  </span>
                ))}
              </div>
            </div>
          )}
          {currentDeny.length > 0 && (
            <div className="flex items-start gap-2">
              <ArrowDownIcon
                className="mt-0.5 size-3.5 shrink-0 text-destructive"
                weight="light"
              />
              <div className="flex flex-wrap gap-1.5">
                {currentDeny.map((rule) => (
                  <span
                    key={rule}
                    className="border border-dashed border-border px-2 py-0.5 font-mono text-xs text-foreground/80"
                  >
                    {rule}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-foreground/40">
          No rules configured
        </p>
      )}
    </div>
  )
}

export function MetadataSection({ sandbox }: { sandbox: SandboxResponse }) {
  const patchMutation = usePatchSandbox()
  const [editing, setEditing] = useState(false)
  const [entries, setEntries] = useState<{ key: string; value: string }[]>([])

  const currentEntries = Object.entries(sandbox.metadata ?? {})

  const startEdit = () => {
    setEntries(
      currentEntries.length > 0
        ? currentEntries.map(([key, value]) => ({ key, value }))
        : [{ key: "", value: "" }],
    )
    setEditing(true)
  }

  const handleSave = () => {
    const metadata: Record<string, string> = {}
    for (const entry of entries) {
      const k = entry.key.trim()
      const v = entry.value.trim()
      if (k) metadata[k] = v
    }
    patchMutation.mutate(
      { id: sandbox.id, data: { metadata } },
      { onSuccess: () => setEditing(false) },
    )
  }

  if (editing) {
    return (
      <div>
        <div className="flex h-10 items-center justify-between px-4">
          <h2 className="text-sm font-semibold text-foreground">Metadata</h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={patchMutation.isPending}
            >
              {patchMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        <div className="space-y-2 p-4">
          {entries.map((entry, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="key"
                value={entry.key}
                onChange={(e) => {
                  const updated = [...entries]
                  updated[i] = { ...entry, key: e.target.value }
                  setEntries(updated)
                }}
                className="flex-1"
              />
              <Input
                placeholder="value"
                value={entry.value}
                onChange={(e) => {
                  const updated = [...entries]
                  updated[i] = { ...entry, value: e.target.value }
                  setEntries(updated)
                }}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => setEntries(entries.filter((_, j) => j !== i))}
              >
                <TrashIcon className="size-3.5 text-muted" weight="light" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setEntries([...entries, { key: "", value: "" }])}
          >
            <PlusIcon className="size-3.5" weight="light" />
            Add
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex h-10 items-center justify-between px-4">
        <h2 className="text-sm font-semibold text-foreground">Metadata</h2>
        <Button variant="ghost" size="icon-sm" onClick={startEdit}>
          <PencilSimpleIcon className="size-3.5 text-muted" weight="light" />
        </Button>
      </div>
      {currentEntries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 py-4">
          {currentEntries.map(([key, value]) => (
            <span
              key={key}
              className="border border-dashed border-border px-2 py-0.5 font-mono text-xs text-foreground/80"
            >
              {key}={value}
            </span>
          ))}
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-foreground/40">No metadata</p>
      )}
    </div>
  )
}

export function SandboxInfoGrid({ sandbox }: SandboxInfoGridProps) {
  return (
    <div className="border-b border-border">
      <div className="grid grid-cols-5">
        <div className="border-r border-border px-4 py-4">
          <p className="text-xs text-muted">Resources</p>
          <p className="mt-2 text-sm text-foreground/80 tabular-nums">
            {sandbox.vcpu_count} vCPU &middot; {sandbox.memory_mib} MB
          </p>
        </div>
        <div className="border-r border-border px-4 py-4">
          <p className="text-xs text-muted">Timeout</p>
          <p className="mt-2 font-mono text-sm text-foreground/80">
            {sandbox.timeout_seconds
              ? formatTimeout(sandbox.timeout_seconds)
              : "None"}
          </p>
        </div>
        <div className="border-r border-border px-4 py-4">
          <p className="text-xs text-muted">Auto-delete</p>
          <p className="mt-2 font-mono text-sm text-foreground/80">
            {formatAutoDelete(sandbox)}
          </p>
        </div>
        <div className="border-r border-border px-4 py-4">
          <p className="text-xs text-muted">Snapshot</p>
          <p className="mt-2 font-mono text-sm text-foreground/80">
            {sandbox.snapshot_id
              ? `${sandbox.snapshot_id.slice(0, 12)}...`
              : "None"}
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-xs text-muted">Created</p>
          <p className="mt-2 text-sm text-foreground/80 tabular-nums">
            {formatDate(new Date(sandbox.created_at))}
          </p>
        </div>
      </div>
    </div>
  )
}
