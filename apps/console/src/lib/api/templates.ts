import { apiClient, apiClientList, type PagedResult } from "./client"
import type {
  CreateTemplateRequest,
  CreateTemplateResponse,
  TemplateBuildResponse,
  TemplateListParams,
  TemplateResponse,
} from "./types"

/**
 * Full (unpaginated) template list. Backs the create-sandbox template picker,
 * which needs every template to choose from. Optional prefix filter.
 */
export async function listTemplates(params?: {
  name_prefix?: string
}): Promise<TemplateResponse[]> {
  const query = new URLSearchParams()
  if (params?.name_prefix) query.set("name_prefix", params.name_prefix)
  const suffix = query.toString()
  return apiClient<TemplateResponse[]>(
    `/templates${suffix ? `?${suffix}` : ""}`,
  )
}

function templateListQuery(params: TemplateListParams): string {
  const q = new URLSearchParams()
  q.set("limit", String(params.pageSize))
  q.set("offset", String((params.page - 1) * params.pageSize))
  q.set("sort", params.sort)
  q.set("order", params.order)
  q.set("owner", params.owner)
  if (params.q) q.set("q", params.q)
  return q.toString()
}

/** Paginated template list backing the Templates page. */
export async function listTemplatesPaged(
  params: TemplateListParams,
): Promise<PagedResult<TemplateResponse>> {
  return apiClientList<TemplateResponse>(
    `/templates?${templateListQuery(params)}`,
  )
}

export async function getTemplate(id: string): Promise<TemplateResponse> {
  return apiClient<TemplateResponse>(`/templates/${id}`)
}

export async function createTemplate(
  data: CreateTemplateRequest,
): Promise<CreateTemplateResponse> {
  return apiClient<CreateTemplateResponse>("/templates", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function deleteTemplate(id: string): Promise<void> {
  return apiClient<void>(`/templates/${id}`, { method: "DELETE" })
}

export async function listTemplateBuilds(
  templateId: string,
  params?: { limit?: number },
): Promise<TemplateBuildResponse[]> {
  const query = new URLSearchParams()
  if (params?.limit) query.set("limit", String(params.limit))
  const suffix = query.toString()
  return apiClient<TemplateBuildResponse[]>(
    `/templates/${templateId}/builds${suffix ? `?${suffix}` : ""}`,
  )
}

export async function createTemplateBuild(
  templateId: string,
): Promise<TemplateBuildResponse> {
  return apiClient<TemplateBuildResponse>(`/templates/${templateId}/builds`, {
    method: "POST",
  })
}

export async function getTemplateBuild(
  templateId: string,
  buildId: string,
): Promise<TemplateBuildResponse> {
  return apiClient<TemplateBuildResponse>(
    `/templates/${templateId}/builds/${buildId}`,
  )
}

export async function cancelTemplateBuild(
  templateId: string,
  buildId: string,
): Promise<void> {
  return apiClient<void>(`/templates/${templateId}/builds/${buildId}`, {
    method: "DELETE",
  })
}
