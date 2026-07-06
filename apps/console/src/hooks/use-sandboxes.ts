"use client"

import { useToast } from "@superserve/ui"
import {
  keepPreviousData,
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { ApiError, type PagedResult } from "@/lib/api/client"
import { sandboxKeys } from "@/lib/api/query-keys"
import {
  attachSandboxSecret,
  createSandbox,
  deleteSandbox,
  detachSandboxSecret,
  getSandbox,
  listSandboxesPaged,
  patchSandbox,
  pauseSandbox,
  resumeSandbox,
} from "@/lib/api/sandboxes"
import type {
  CreateSandboxRequest,
  SandboxListItem,
  SandboxListParams,
  SandboxPatch,
  SandboxResponse,
} from "@/lib/api/types"

type SandboxPage = PagedResult<SandboxListItem>
type SandboxListSnapshots = [QueryKey, SandboxPage | undefined][]

// --- List-cache helpers -------------------------------------------------
// Sandbox list results are cached per (page, sort, filter) combination under
// sandboxKeys.lists(). These helpers snapshot / patch / restore every cached
// variant at once, so an optimistic mutation stays correct no matter which
// page or filter the user is currently looking at. Totals are intentionally
// not adjusted here — the onSettled invalidation refetches the authoritative
// count.

function snapshotSandboxLists(qc: QueryClient): SandboxListSnapshots {
  return qc.getQueriesData<SandboxPage>({ queryKey: sandboxKeys.lists() })
}

function restoreSandboxLists(qc: QueryClient, snapshots: SandboxListSnapshots) {
  for (const [key, data] of snapshots) qc.setQueryData(key, data)
}

function patchSandboxLists(
  qc: QueryClient,
  updater: (items: SandboxListItem[]) => SandboxListItem[],
) {
  qc.setQueriesData<SandboxPage>({ queryKey: sandboxKeys.lists() }, (old) =>
    old ? { ...old, items: updater(old.items) } : old,
  )
}

// --- Queries ------------------------------------------------------------

export function useSandboxesPage(params: SandboxListParams) {
  return useQuery({
    queryKey: sandboxKeys.list(params),
    queryFn: () => listSandboxesPaged(params),
    // Keep the current page on screen while the next page/sort/filter loads,
    // so navigation doesn't flash an empty table.
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
}

export function useSandbox(id: string | null) {
  return useQuery({
    queryKey: sandboxKeys.detail(id ?? ""),
    queryFn: () => getSandbox(id as string),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "resuming" ? 2000 : false
    },
    refetchOnWindowFocus: true,
  })
}

// --- Mutations ----------------------------------------------------------

export function useCreateSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: CreateSandboxRequest) => createSandbox(data),
    onSuccess: (newSandbox) => {
      // A new sandbox lands on page 1 under the default created_at-desc sort;
      // refetch the lists rather than guessing its slot under the active
      // page/sort/filter.
      queryClient.invalidateQueries({ queryKey: sandboxKeys.lists() })
      addToast(`Sandbox "${newSandbox.name}" created`, "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to create sandbox. Check your plan limits or try again."
      addToast(message, "error")
    },
  })
}

export function useDeleteSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => deleteSandbox(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.lists() })
      const snapshots = snapshotSandboxLists(queryClient)
      patchSandboxLists(queryClient, (items) =>
        items.filter((s) => s.id !== id),
      )
      return { snapshots }
    },
    onError: (error, _id, context) => {
      if (context) restoreSandboxLists(queryClient, context.snapshots)
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to delete sandbox. The sandbox may already be deleted."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function useBulkDeleteSandboxes() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteSandbox(id)))
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.lists() })
      const snapshots = snapshotSandboxLists(queryClient)
      const idSet = new Set(ids)
      patchSandboxLists(queryClient, (items) =>
        items.filter((s) => !idSet.has(s.id)),
      )
      return { snapshots }
    },
    onError: (error, _ids, context) => {
      if (context) restoreSandboxLists(queryClient, context.snapshots)
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to delete sandboxes. Some may have already been deleted."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function usePauseSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => pauseSandbox(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.lists() })
      const snapshots = snapshotSandboxLists(queryClient)
      const previousDetail = queryClient.getQueryData<SandboxResponse>(
        sandboxKeys.detail(id),
      )
      patchSandboxLists(queryClient, (items) =>
        items.map((s) => (s.id === id ? { ...s, status: "paused" } : s)),
      )
      queryClient.setQueryData<SandboxResponse>(sandboxKeys.detail(id), (old) =>
        old ? { ...old, status: "paused" } : old,
      )
      return { snapshots, previousDetail }
    },
    onError: (error, id, context) => {
      if (context) {
        restoreSandboxLists(queryClient, context.snapshots)
        if (context.previousDetail !== undefined) {
          queryClient.setQueryData(
            sandboxKeys.detail(id),
            context.previousDetail,
          )
        }
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to pause sandbox. It may have already stopped."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function useResumeSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => resumeSandbox(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sandboxKeys.lists() })
      const snapshots = snapshotSandboxLists(queryClient)
      const previousDetail = queryClient.getQueryData<SandboxResponse>(
        sandboxKeys.detail(id),
      )
      patchSandboxLists(queryClient, (items) =>
        items.map((s) => (s.id === id ? { ...s, status: "resuming" } : s)),
      )
      queryClient.setQueryData<SandboxResponse>(sandboxKeys.detail(id), (old) =>
        old ? { ...old, status: "resuming" } : old,
      )
      return { snapshots, previousDetail }
    },
    onSuccess: (resumed, id) => {
      // The resume response carries a fresh access_token — write it into the
      // detail cache so the terminal and file panels pick it up without waiting
      // for a refetch.
      queryClient.setQueryData<SandboxResponse>(sandboxKeys.detail(id), (old) =>
        old
          ? {
              ...old,
              status: resumed.status,
              access_token: resumed.access_token,
            }
          : old,
      )
      patchSandboxLists(queryClient, (items) =>
        items.map((s) => (s.id === id ? { ...s, status: resumed.status } : s)),
      )
    },
    onError: (error, id, context) => {
      if (context) {
        restoreSandboxLists(queryClient, context.snapshots)
        if (context.previousDetail !== undefined) {
          queryClient.setQueryData(
            sandboxKeys.detail(id),
            context.previousDetail,
          )
        }
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to resume sandbox. Check that it hasn't been deleted."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function usePatchSandbox() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SandboxPatch }) =>
      patchSandbox(id, data),
    onSuccess: () => {
      addToast("Sandbox updated", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to update sandbox."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.all })
    },
  })
}

export function useAttachSandboxSecret(id: string) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: ({
      envKey,
      secretName,
    }: {
      envKey: string
      secretName: string
    }) => attachSandboxSecret(id, envKey, secretName),
    onSuccess: () => {
      addToast("Secret attached", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to attach secret."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.detail(id) })
    },
  })
}

export function useDetachSandboxSecret(id: string) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (envKey: string) => detachSandboxSecret(id, envKey),
    onSuccess: () => {
      addToast("Secret detached", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to detach secret."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sandboxKeys.detail(id) })
    },
  })
}
