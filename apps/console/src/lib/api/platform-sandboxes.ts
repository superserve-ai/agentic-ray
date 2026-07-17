import { apiClient, apiClientList } from "./client"
import type { SandboxListItem, SandboxResponse } from "./types"

export type PlatformSandboxRead = SandboxResponse

function sandboxInventoryQuery(): string {
  const q = new URLSearchParams()
  q.set("limit", "1000")
  q.set("offset", "0")
  q.set("sort", "created_at")
  q.set("order", "desc")
  return q.toString()
}

export async function listPlatformTeamSandboxes(
  _teamId: string,
): Promise<PlatformSandboxRead[]> {
  // Intentionally use the normal customer sandbox endpoint while impersonating.
  // The active impersonation cookie makes /api/[...path] mint/use the temporary
  // team-scoped API key, so sandbox RBAC and response shaping stay on the same
  // path customers use. Do not call /internal/teams/... here.
  const page = await apiClientList<SandboxListItem>(
    `/sandboxes?${sandboxInventoryQuery()}`,
  )

  return page.items as PlatformSandboxRead[]
}

export async function getPlatformTeamSandbox(
  _teamId: string,
  sandboxId: string,
): Promise<PlatformSandboxRead> {
  // Same as above: read through the normal customer endpoint under the
  // temporary impersonation API key.
  return apiClient<SandboxResponse>(
    `/sandboxes/${encodeURIComponent(sandboxId)}`,
  )
}
