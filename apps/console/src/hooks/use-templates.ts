"use client"

import { useToast } from "@superserve/ui"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { useQueryScope } from "@/components/query-provider"
import { ApiError, type PagedResult } from "@/lib/api/client"
import { templateKeys } from "@/lib/api/query-keys"
import {
  cancelTemplateBuild,
  createTemplate,
  createTemplateBuild,
  deleteTemplate,
  getTemplate,
  getTemplateBuild,
  listTemplateBuilds,
  listTemplates,
  listTemplatesPaged,
} from "@/lib/api/templates"
import type {
  CreateTemplateRequest,
  TemplateListParams,
  TemplateResponse,
} from "@/lib/api/types"

const TERMINAL_TEMPLATE_STATUSES = new Set(["ready", "failed"])
const TERMINAL_BUILD_STATUSES = new Set(["ready", "failed", "cancelled"])

/** Paginated template list backing the Templates page. */
export function useTemplatesPage(params: TemplateListParams) {
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: [...templateKeys.list(params), queryScope],
    queryFn: () => listTemplatesPaged(params),
    // Keep the current page on screen while the next page/sort/filter loads.
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
}

/**
 * Full (unpaginated) template list backing the create-sandbox template picker,
 * which needs every template to choose from.
 */
export function useTemplates() {
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: [...templateKeys.fullList(), queryScope],
    queryFn: () => listTemplates(),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
}

export function useTemplate(id: string | null) {
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: [...templateKeys.detail(id ?? ""), queryScope],
    queryFn: () => getTemplate(id as string),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status) return false
      return TERMINAL_TEMPLATE_STATUSES.has(status) ? false : 5_000
    },
    refetchOnWindowFocus: true,
  })
}

export function useTemplateBuilds(templateId: string | null) {
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: [...templateKeys.builds(templateId ?? ""), queryScope],
    queryFn: () => listTemplateBuilds(templateId as string, { limit: 20 }),
    enabled: !!templateId,
    refetchInterval: (query) => {
      const latest = query.state.data?.[0]
      if (!latest) return 5_000
      return TERMINAL_BUILD_STATUSES.has(latest.status) ? false : 5_000
    },
  })
}

export function useTemplateBuild(
  templateId: string | null,
  buildId: string | null,
) {
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: [
      ...templateKeys.build(templateId ?? "", buildId ?? ""),
      queryScope,
    ],
    queryFn: () => getTemplateBuild(templateId as string, buildId as string),
    enabled: !!templateId && !!buildId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status) return false
      return TERMINAL_BUILD_STATUSES.has(status) ? false : 3_000
    },
  })
}

export function useCreateTemplate() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: CreateTemplateRequest) => createTemplate(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
      addToast(`Template "${created.name}" created — build queued`, "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to create template. Check your plan limits or try again."
      addToast(message, "error")
    },
  })
}

export function useRebuildTemplate() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (templateId: string) => createTemplateBuild(templateId),
    onSuccess: (_build, templateId) => {
      queryClient.invalidateQueries({
        queryKey: templateKeys.detail(templateId),
      })
      queryClient.invalidateQueries({
        queryKey: templateKeys.builds(templateId),
      })
      addToast("Rebuild queued", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to rebuild template."
      addToast(message, "error")
    },
  })
}

export function useCancelTemplateBuild(templateId: string) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (buildId: string) => cancelTemplateBuild(templateId, buildId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: templateKeys.detail(templateId),
      })
      queryClient.invalidateQueries({
        queryKey: templateKeys.builds(templateId),
      })
      addToast("Build cancelled", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to cancel build."
      addToast(message, "error")
    },
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.all })
      // Two cache shapes hold templates: the paginated page ({ items, total })
      // and the picker's full array. Optimistically drop the row from both.
      const pagedSnapshots = queryClient.getQueriesData<
        PagedResult<TemplateResponse>
      >({ queryKey: templateKeys.lists() })
      const fullSnapshots = queryClient.getQueriesData<TemplateResponse[]>({
        queryKey: templateKeys.fullLists(),
      })
      queryClient.setQueriesData<PagedResult<TemplateResponse>>(
        { queryKey: templateKeys.lists() },
        (old) =>
          old ? { ...old, items: old.items.filter((t) => t.id !== id) } : old,
      )
      queryClient.setQueriesData<TemplateResponse[]>(
        { queryKey: templateKeys.fullLists() },
        (old) => (old ? old.filter((t) => t.id !== id) : old),
      )
      return { pagedSnapshots, fullSnapshots }
    },
    onError: (error, _id, context) => {
      for (const [key, data] of context?.pagedSnapshots ?? []) {
        queryClient.setQueryData(key, data)
      }
      for (const [key, data] of context?.fullSnapshots ?? []) {
        queryClient.setQueryData(key, data)
      }
      const message =
        error instanceof ApiError ? error.message : "Failed to delete template."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}
