"use client"

import { PlusIcon, LockKeyIcon } from "@phosphor-icons/react"
import { Button, Table, TableHead, TableHeader, TableRow } from "@superserve/ui"
import { Suspense, useMemo, useState } from "react"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { CreateSecretDialog } from "@/components/secrets/create-secret-dialog"
import { SecretTableRow } from "@/components/secrets/secret-table-row"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { useCreateParam } from "@/hooks/use-create-param"
import { useProviders } from "@/hooks/use-providers"
import { useSecrets } from "@/hooks/use-secrets"

export default function SecretsPage() {
  return (
    <Suspense fallback={<TableSkeleton columns={6} />}>
      <SecretsPageContent />
    </Suspense>
  )
}

function SecretsPageContent() {
  const [createOpen, setCreateOpen] = useCreateParam()
  const [search, setSearch] = useState("")

  const { data: secrets, isPending, error, refetch } = useSecrets()
  const { data: providers } = useProviders()

  const providerDisplay = useMemo(
    () => new Map(providers?.map((p) => [p.name, p.display])),
    [providers],
  )

  const filtered = useMemo(() => {
    if (!secrets) return []
    const q = search.trim().toLowerCase()
    if (!q) return secrets
    return secrets.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.provider_shortcut?.toLowerCase().includes(q),
    )
  }, [secrets, search])

  const newButton = (
    <Button size="sm" onClick={() => setCreateOpen(true)}>
      <PlusIcon className="size-3.5" weight="light" />
      Add secret
    </Button>
  )

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Secrets">{newButton}</PageHeader>
        <TableSkeleton columns={6} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Secrets">{newButton}</PageHeader>
        <ErrorState onRetry={() => refetch()} />
      </div>
    )
  }

  const isEmpty = (secrets?.length ?? 0) === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Secrets">{newButton}</PageHeader>

      {isEmpty ? (
        <EmptyState
          icon={LockKeyIcon}
          title="No secrets yet"
          description="Encrypted credentials that code in your sandboxes can use without ever seeing the value. Add one to get started."
          actionLabel="Add secret"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <>
          <TableToolbar
            searchPlaceholder="Search secrets…"
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex flex-1 flex-col overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState
                icon={LockKeyIcon}
                title="No secrets match that search"
                description="Try a different name or provider."
              />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
                  <TableRow>
                    <TableHead className="w-[22%]">Name</TableHead>
                    <TableHead className="w-[14%]">Provider</TableHead>
                    <TableHead className="w-[12%]">Auth</TableHead>
                    <TableHead className="w-[28%]">Hosts</TableHead>
                    <TableHead className="w-[12%]">Last used</TableHead>
                    <TableHead className="w-[12%]">Created</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <StickyHoverTableBody>
                  {filtered.map((s) => (
                    <SecretTableRow
                      key={s.id}
                      secret={s}
                      providerDisplay={
                        s.provider_shortcut
                          ? providerDisplay.get(s.provider_shortcut)
                          : undefined
                      }
                    />
                  ))}
                </StickyHoverTableBody>
              </Table>
            )}
          </div>
        </>
      )}

      <CreateSecretDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        hideTrigger
      />
    </div>
  )
}
