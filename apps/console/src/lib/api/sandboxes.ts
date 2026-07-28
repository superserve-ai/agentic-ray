import { registerPreviewTokenQueryParam } from "@/lib/preview-token-redaction"

import { apiClient, apiClientList, type PagedResult } from "./client"
import type {
  CreateSandboxRequest,
  PreviewAccessPolicy,
  PreviewPortList,
  PreviewTokenResponse,
  PublishedPreviewPort,
  ResumeResponse,
  SandboxListItem,
  SandboxListParams,
  SandboxPatch,
  SandboxResponse,
} from "./types"

function sandboxListQuery(params: SandboxListParams): string {
  const q = new URLSearchParams()
  q.set("limit", String(params.pageSize))
  q.set("offset", String((params.page - 1) * params.pageSize))
  q.set("sort", params.sort)
  q.set("order", params.order)
  if (params.status) q.set("status", params.status)
  if (params.q) q.set("q", params.q)
  return q.toString()
}

export async function listSandboxesPaged(
  params: SandboxListParams,
): Promise<PagedResult<SandboxListItem>> {
  return apiClientList<SandboxListItem>(
    `/sandboxes?${sandboxListQuery(params)}`,
  )
}

export async function getSandbox(id: string): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>(`/sandboxes/${id}`)
}

export async function createSandbox(
  data: CreateSandboxRequest,
): Promise<SandboxResponse> {
  return apiClient<SandboxResponse>("/sandboxes", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function deleteSandbox(id: string): Promise<void> {
  return apiClient<void>(`/sandboxes/${id}`, {
    method: "DELETE",
  })
}

export async function patchSandbox(
  id: string,
  data: SandboxPatch,
): Promise<void> {
  return apiClient<void>(`/sandboxes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

export async function pauseSandbox(id: string): Promise<void> {
  return apiClient<void>(`/sandboxes/${id}/pause`, {
    method: "POST",
  })
}

export async function resumeSandbox(id: string): Promise<ResumeResponse> {
  return apiClient<ResumeResponse>(`/sandboxes/${id}/resume`, {
    method: "POST",
  })
}

export async function attachSandboxSecret(
  id: string,
  envKey: string,
  secretName: string,
): Promise<void> {
  return apiClient<void>(`/sandboxes/${id}/secrets`, {
    method: "POST",
    body: JSON.stringify({ env_key: envKey, secret_name: secretName }),
  })
}

export async function detachSandboxSecret(
  id: string,
  envKey: string,
): Promise<void> {
  return apiClient<void>(
    `/sandboxes/${id}/secrets/${encodeURIComponent(envKey)}`,
    { method: "DELETE" },
  )
}

export async function listSandboxPreviewPorts(
  id: string,
): Promise<PreviewPortList> {
  return apiClient<PreviewPortList>(`/sandboxes/${id}/preview-ports`)
}

export async function publishSandboxPreviewPort(
  id: string,
  port: number,
  access?: PreviewAccessPolicy,
): Promise<PublishedPreviewPort> {
  return apiClient<PublishedPreviewPort>(`/sandboxes/${id}/preview-ports`, {
    method: "POST",
    body: JSON.stringify(access === undefined ? { port } : { port, access }),
  })
}

export async function unpublishSandboxPreviewPort(
  id: string,
  port: number,
): Promise<void> {
  return apiClient<void>(`/sandboxes/${id}/preview-ports/${port}`, {
    method: "DELETE",
  })
}

export async function mintSandboxPreviewToken(
  id: string,
  port: number,
  expiresInSeconds?: number,
): Promise<PreviewTokenResponse> {
  const credential = await apiClient<PreviewTokenResponse>(
    `/sandboxes/${id}/preview-ports/${port}/token`,
    {
      method: "POST",
      body: JSON.stringify(
        expiresInSeconds === undefined
          ? {}
          : { expires_in_seconds: expiresInSeconds },
      ),
    },
  )
  registerPreviewTokenQueryParam(credential.query_param)
  return credential
}

export async function rotateSandboxPreviewToken(
  id: string,
  port: number,
): Promise<PreviewTokenResponse> {
  const credential = await apiClient<PreviewTokenResponse>(
    `/sandboxes/${id}/preview-ports/${port}/token/rotate`,
    { method: "POST" },
  )
  registerPreviewTokenQueryParam(credential.query_param)
  return credential
}
