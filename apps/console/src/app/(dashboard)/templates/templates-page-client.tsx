"use client"

import { PlusIcon, StackIcon } from "@phosphor-icons/react"
import {
  Button,
  cn,
  Table,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect } from "react"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { SortableTableHead } from "@/components/sortable-table-head"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { CreateTemplateDialog } from "@/components/templates/create-template-dialog"
import { TemplateTableRow } from "@/components/templates/template-table-row"
import { useCreateParam } from "@/hooks/use-create-param"
import { useListParams } from "@/hooks/use-list-params"
import { useTemplatesPage } from "@/hooks/use-templates"
import {
  TEMPLATE_SORT_COLUMNS,
  type TemplateListParams,
  type TemplateOwnerFilter,
} from "@/lib/api/types"

const OWNER_TABS = [
  { label: "All", value: "all" },
  { label: "Team", value: "team" },
  { label: "System", value: "system" },
]

export default function TemplatesPageClient() {
  return (
    <Suspense fallback={<TableSkeleton columns={6} tabs={3} />}>
      <TemplatesPageContent />
    </Suspense>
  )
}

function TemplatesPageContent() {
  const searchParams = useSearchParams()
  const [createOpen, setCreateOpen] = useCreateParam()

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
  } = useListParams({
    columns: TEMPLATE_SORT_COLUMNS,
    defaultSort: "created_at",
  })

  const rawOwner = searchParams.get("owner")
  const owner: TemplateOwnerFilter =
    rawOwner === "team" || rawOwner === "system" ? rawOwner : "all"

  const params: TemplateListParams = {
    page,
    pageSize,
    sort,
    order,
    owner,
    q: debouncedQ || undefined,
  }

  const { data, isPending, error, refetch, isPlaceholderData } =
    useTemplatesPage(params)
  const templates = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    if (total > 0 && page > pageCount) setPage(pageCount)
  }, [total, page, pageCount, setPage])

  const hasFilters = owner !== "all" || debouncedQ !== ""
  const isEmpty =
    !isPending && !error && !isPlaceholderData && total === 0 && !hasFilters

  const newButton = (
    <Button size="sm" onClick={() => setCreateOpen(true)}>
      <PlusIcon className="size-3.5" weight="light" />
      Create template
    </Button>
  )

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Templates">{newButton}</PageHeader>
        <TableSkeleton columns={6} tabs={3} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Templates">{newButton}</PageHeader>
        <ErrorState onRetry={() => refetch()} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Templates">{newButton}</PageHeader>

      {isEmpty ? (
        <EmptyState
          icon={StackIcon}
          title="No templates yet"
          description="Templates are pre-baked VM images your sandboxes boot from. Create one to reuse the same environment across sandboxes."
          actionLabel="Create template"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <>
          <TableToolbar
            id="templates-toolbar"
            tabs={OWNER_TABS}
            activeTab={owner}
            onTabChange={(v) => setParam({ owner: v === "all" ? null : v })}
            searchPlaceholder="Search names…"
            searchValue={q}
            onSearchChange={setSearch}
          />

          <div
            className={cn(
              "flex flex-1 flex-col overflow-y-auto transition-opacity",
              isPlaceholderData && "opacity-60",
            )}
          >
            {templates.length === 0 ? (
              <EmptyState
                icon={StackIcon}
                title={
                  q
                    ? "No templates match that search"
                    : owner === "team"
                      ? "No team templates yet"
                      : "No system templates available"
                }
                description={
                  q
                    ? "Try a different name."
                    : owner === "team"
                      ? "Create one to get started."
                      : "System templates are curated by Superserve."
                }
                actionLabel={
                  !q && owner === "team" ? "Create template" : undefined
                }
                onAction={
                  !q && owner === "team" ? () => setCreateOpen(true) : undefined
                }
              />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
                  <TableRow>
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
                      className="w-[12%]"
                    />
                    <TableHead className="w-[26%]">Resources</TableHead>
                    <SortableTableHead
                      column="created_at"
                      label="Created"
                      activeSort={sort}
                      order={order}
                      onSort={toggleSort}
                      className="w-[14%]"
                    />
                    <SortableTableHead
                      column="built_at"
                      label="Updated"
                      activeSort={sort}
                      order={order}
                      onSort={toggleSort}
                      className="w-[14%]"
                    />
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <StickyHoverTableBody>
                  {templates.map((t) => (
                    <TemplateTableRow key={t.id} template={t} />
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

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        hideTrigger
      />
    </div>
  )
}
