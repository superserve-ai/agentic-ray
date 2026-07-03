"use client"

import { Suspense } from "react"

import { TableSkeleton } from "@/components/table-skeleton"

export default function SandboxesPage() {
  return (
    <Suspense fallback={<TableSkeleton columns={6} tabs={3} />}>
      <SandboxesPageContent />
    </Suspense>
  )
}

import { CubeIcon } from "@phosphor-icons/react"
import {
  Checkbox,
  cn,
  Table,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useRouter, useSearchParams } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { ConnectSandboxDialog } from "@/components/sandboxes/connect-sandbox-dialog"
import { CreateSandboxDialog } from "@/components/sandboxes/create-sandbox-dialog"
import { DeleteSandboxDialog } from "@/components/sandboxes/delete-sandbox-dialog"
import { SandboxTableRow } from "@/components/sandboxes/sandbox-table-row"
import { SortableTableHead } from "@/components/sortable-table-head"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"
import { useCreateParam } from "@/hooks/use-create-param"
import { useListParams } from "@/hooks/use-list-params"
import {
  useBulkDeleteSandboxes,
  useDeleteSandbox,
  usePauseSandbox,
  useResumeSandbox,
  useSandboxesPage,
} from "@/hooks/use-sandboxes"
import { useSelection } from "@/hooks/use-selection"
import type { SandboxListParams, SandboxSortColumn } from "@/lib/api/types"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

const STATUS_TABS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Paused", value: "paused" },
]

function SandboxesPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const posthog = usePostHog()

  const {
    page,
    pageSize,
    sort,
    order,
    q,
    debouncedQ,
    setParam,
    toggleSort,
    setPage,
    setPageSize,
    setSearch,
  } = useListParams({ defaultSort: "created_at" })

  const statusTab = searchParams.get("status") ?? "all"

  const params: SandboxListParams = {
    page,
    pageSize,
    sort: sort as SandboxSortColumn,
    order,
    status: statusTab === "all" ? undefined : statusTab,
    q: debouncedQ || undefined,
  }

  const [createOpen, setCreateOpen] = useCreateParam()
  const [connectSandboxId, setConnectSandboxId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [templateRef, setTemplateRef] = useState<string | null>(null)

  // When the user clicks "Launch sandbox" from the templates section, we
  // navigate here with ?from_template=<name>. Open the dialog with the
  // template prefilled, then strip the param so refreshing doesn't re-open.
  useEffect(() => {
    const name = searchParams.get("from_template")
    if (!name) return
    setTemplateRef(name)
    setCreateOpen(true)
    const next = new URLSearchParams(searchParams.toString())
    next.delete("from_template")
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : window.location.pathname)
  }, [searchParams, router, setCreateOpen])

  const { data, isPending, error, refetch, isPlaceholderData } =
    useSandboxesPage(params)
  const sandboxes = data?.items ?? []
  const total = data?.total ?? 0

  const deleteSandbox = useDeleteSandbox()
  const bulkDelete = useBulkDeleteSandboxes()
  const pauseMutation = usePauseSandbox()
  const resumeMutation = useResumeSandbox()

  const {
    selected,
    allSelected,
    someSelected,
    toggleAll,
    toggleOne,
    clearSelection,
  } = useSelection(sandboxes)

  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // If the current page falls past the end (e.g. after deleting the last row on
  // the last page), snap back to the last valid page.
  useEffect(() => {
    if (total > 0 && page > pageCount) setPage(pageCount)
  }, [total, page, pageCount, setPage])

  // Selection is scoped to the current view — clear it when the page, filter, or
  // search changes so a bulk action can't hit rows that scrolled off-page.
  useEffect(() => {
    clearSelection()
  }, [page, statusTab, debouncedQ, clearSelection])

  const hasFilters = statusTab !== "all" || q !== ""
  // A truly empty account (no sandboxes at all) gets the create call-to-action.
  // A zero-result filter/search keeps the toolbar so the user can clear it.
  const isEmpty = !isPending && !error && total === 0 && !hasFilters

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Sandboxes">
        <CreateSandboxDialog
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v)
            if (!v) setTemplateRef(null)
          }}
          hideTrigger={isEmpty || isPending}
          onCreated={(id) => setConnectSandboxId(id)}
          initialTemplateRef={templateRef}
        />
      </PageHeader>

      {isPending ? (
        <TableSkeleton columns={6} tabs={3} />
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : isEmpty ? (
        <EmptyState
          icon={CubeIcon}
          title="No Sandboxes"
          description="Create a sandbox to run code in an isolated cloud environment."
          actionLabel="Create Sandbox"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <>
          <TableToolbar
            tabs={STATUS_TABS}
            activeTab={statusTab}
            onTabChange={(v) => setParam({ status: v === "all" ? null : v })}
            searchPlaceholder="Search sandboxes..."
            searchValue={q}
            onSearchChange={setSearch}
            selectedCount={selected.size}
            onClearSelection={clearSelection}
            onDeleteSelected={() => setBulkDeleteOpen(true)}
          />

          <div
            className={cn(
              "flex-1 overflow-y-auto transition-opacity",
              isPlaceholderData && "opacity-60",
            )}
          >
            {sandboxes.length === 0 ? (
              <EmptyState
                icon={CubeIcon}
                title="No sandboxes match"
                description="Try a different search term or status filter."
              />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
                  <TableRow>
                    <TableHead className="w-10 pr-0">
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected && !allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all sandboxes"
                      />
                    </TableHead>
                    <SortableTableHead
                      column="name"
                      label="Name"
                      activeSort={sort}
                      order={order}
                      onSort={toggleSort}
                      className="w-[30%]"
                    />
                    <SortableTableHead
                      column="status"
                      label="Status"
                      activeSort={sort}
                      order={order}
                      onSort={toggleSort}
                      className="w-[15%]"
                    />
                    <TableHead className="w-[15%]">Resources</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <StickyHoverTableBody>
                  {sandboxes.map((sandbox) => (
                    <SandboxTableRow
                      key={sandbox.id}
                      sandbox={sandbox}
                      selected={selected.has(sandbox.id)}
                      onToggle={() => toggleOne(sandbox.id)}
                      onConnect={() => {
                        posthog.capture(SANDBOX_EVENTS.CONNECT_OPENED, {
                          sandbox_id: sandbox.id,
                        })
                        setConnectSandboxId(sandbox.id)
                      }}
                      onDelete={() =>
                        setDeleteTarget({
                          id: sandbox.id,
                          name: sandbox.name,
                        })
                      }
                      onPause={() => {
                        posthog.capture(SANDBOX_EVENTS.PAUSED, {
                          sandbox_id: sandbox.id,
                        })
                        pauseMutation.mutate(sandbox.id)
                      }}
                      onResume={() => {
                        posthog.capture(SANDBOX_EVENTS.RESUMED, {
                          sandbox_id: sandbox.id,
                        })
                        resumeMutation.mutate(sandbox.id)
                      }}
                      onOpenTerminal={() =>
                        posthog.capture(SANDBOX_EVENTS.TERMINAL_OPENED, {
                          sandbox_id: sandbox.id,
                          source: "list_menu",
                        })
                      }
                    />
                  ))}
                </StickyHoverTableBody>
              </Table>
            )}
          </div>

          {total > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </>
      )}

      {connectSandboxId && (
        <ConnectSandboxDialog
          sandboxId={connectSandboxId}
          open={!!connectSandboxId}
          onOpenChange={(v) => {
            if (!v) setConnectSandboxId(null)
          }}
        />
      )}

      {deleteTarget && (
        <DeleteSandboxDialog
          open={!!deleteTarget}
          onOpenChange={(v) => {
            if (!v) setDeleteTarget(null)
          }}
          sandboxName={deleteTarget.name}
          onConfirm={() => {
            posthog.capture(SANDBOX_EVENTS.DELETED, { id: deleteTarget.id })
            return new Promise<void>((resolve, reject) => {
              deleteSandbox.mutate(deleteTarget.id, {
                onSuccess: () => {
                  setDeleteTarget(null)
                  resolve()
                },
                onError: reject,
              })
            })
          }}
        />
      )}

      <DeleteSandboxDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        bulkCount={selected.size}
        onConfirm={() => {
          posthog.capture(SANDBOX_EVENTS.BULK_DELETED, {
            count: selected.size,
          })
          return new Promise<void>((resolve, reject) => {
            bulkDelete.mutate([...selected], {
              onSuccess: () => {
                clearSelection()
                setBulkDeleteOpen(false)
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
