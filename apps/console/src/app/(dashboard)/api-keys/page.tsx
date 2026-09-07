"use client"

import { Suspense } from "react"

import { AnimatedTableRow } from "@/components/animated-table-row"
import { TableSkeleton } from "@/components/table-skeleton"

export default function ApiKeysPage() {
  return (
    <Suspense fallback={<TableSkeleton columns={4} />}>
      <ApiKeysPageContent />
    </Suspense>
  )
}

import {
  DotsThreeVerticalIcon,
  KeyIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Button,
  Checkbox,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useRouter, useSearchParams } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useMemo, useState } from "react"

import { CreateKeyDialog } from "@/components/api-keys/create-key-dialog"
import { RevokeKeyDialog } from "@/components/api-keys/revoke-key-dialog"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"
import {
  useApiKeys,
  useBulkRevokeApiKeys,
  useRevokeApiKey,
} from "@/hooks/use-api-keys"
import { useCreateParam } from "@/hooks/use-create-param"
import { useSelection } from "@/hooks/use-selection"
import { formatDate } from "@/lib/format"
import { API_KEY_EVENTS } from "@/lib/posthog/events"

function ApiKeysPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const posthog = usePostHog()
  const { data: keys, isPending, error, refetch } = useApiKeys()
  const revokeMutation = useRevokeApiKey()
  const bulkRevoke = useBulkRevokeApiKeys()
  const search = searchParams.get("q") ?? ""

  const setSearch = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (!value) params.delete("q")
    else params.set("q", value)
    router.replace(`?${params.toString()}`)
  }
  const [createOpen, setCreateOpen] = useCreateParam()
  const [revokeTarget, setRevokeTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const [bulkRevokeOpen, setBulkRevokeOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!keys) return []
    const visible = keys.filter((k) => !k.name.startsWith("__console_"))
    if (!search) return visible
    return visible.filter(
      (k) =>
        k.name.toLowerCase().includes(search.toLowerCase()) ||
        k.prefix.toLowerCase().includes(search.toLowerCase()),
    )
  }, [keys, search])

  const {
    selected,
    allSelected,
    someSelected,
    toggleAll,
    toggleOne,
    clearSelection,
  } = useSelection(filtered)

  const deleteSelected = () => {
    setBulkRevokeOpen(true)
  }

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="API Keys" />
        <TableSkeleton columns={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="API Keys" />
        <ErrorState onRetry={() => refetch()} />
      </div>
    )
  }

  const userKeys = keys?.filter((k) => !k.name.startsWith("__console_")) ?? []
  const isEmpty = userKeys.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="API Keys">
        <CreateKeyDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          hideTrigger={isEmpty}
        />
      </PageHeader>

      {isEmpty ? (
        <EmptyState
          icon={KeyIcon}
          title="No API Keys"
          description="Create an API key to authenticate with the Superserve SDK."
          actionLabel="Create Key"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <>
          <TableToolbar
            searchPlaceholder="Search keys..."
            searchValue={search}
            onSearchChange={setSearch}
            selectedCount={selected.size}
            onClearSelection={clearSelection}
            deleteLabel="Revoke"
            onDeleteSelected={deleteSelected}
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
                      aria-label="Select all keys"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((apiKey) => (
                  <AnimatedTableRow key={apiKey.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(apiKey.id)}
                        onCheckedChange={() => toggleOne(apiKey.id)}
                        aria-label={`Select ${apiKey.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{apiKey.name}</TableCell>
                    <TableCell className="text-muted tabular-nums">
                      {formatDate(new Date(apiKey.created_at))}
                    </TableCell>
                    <TableCell className="text-muted tabular-nums">
                      {apiKey.last_used_at
                        ? formatDate(new Date(apiKey.last_used_at))
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Key actions"
                            />
                          }
                        >
                          <DotsThreeVerticalIcon
                            className="size-4"
                            weight="bold"
                          />
                        </MenuTrigger>
                        <MenuPopup>
                          <MenuItem
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              setRevokeTarget({
                                id: apiKey.id,
                                name: apiKey.name,
                              })
                            }
                          >
                            <TrashIcon className="size-4" weight="light" />
                            Revoke Key
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    </TableCell>
                  </AnimatedTableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}

      {revokeTarget && (
        <RevokeKeyDialog
          open={!!revokeTarget}
          onOpenChange={(v) => {
            if (!v) setRevokeTarget(null)
          }}
          keyName={revokeTarget.name}
          onConfirm={() => {
            posthog.capture(API_KEY_EVENTS.REVOKED)
            return new Promise<void>((resolve, reject) => {
              revokeMutation.mutate(revokeTarget.id, {
                onSuccess: () => {
                  setRevokeTarget(null)
                  resolve()
                },
                onError: reject,
              })
            })
          }}
        />
      )}

      <RevokeKeyDialog
        open={bulkRevokeOpen}
        onOpenChange={setBulkRevokeOpen}
        bulkCount={selected.size}
        onConfirm={() => {
          posthog.capture(API_KEY_EVENTS.BULK_REVOKED, {
            count: selected.size,
          })
          return new Promise<void>((resolve, reject) => {
            bulkRevoke.mutate([...selected], {
              onSuccess: () => {
                clearSelection()
                setBulkRevokeOpen(false)
                resolve()
              },
              onError: reject,
            })
          })
        }}
      />
    </div>
  )
}
