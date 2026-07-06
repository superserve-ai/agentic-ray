import { apiClient } from "./client"
import type { NetworkConfig, SandboxStatus } from "./types"

export interface PlatformSandboxRead {
  id: string
  team_id: string
  name: string
  status: SandboxStatus
  vcpu_count: number
  memory_mib: number
  snapshot_id?: string | null
  timeout_seconds?: number | null
  network: NetworkConfig
  metadata: Record<string, string>
  created_at: string
}

function teamQuery(teamId: string): string {
  return `team_id=${encodeURIComponent(teamId)}`
}

export async function listPlatformTeamSandboxes(
  teamId: string,
): Promise<PlatformSandboxRead[]> {
  return apiClient<PlatformSandboxRead[]>(
    `/platform/sandboxes?${teamQuery(teamId)}`,
  )
}

export async function getPlatformTeamSandbox(
  teamId: string,
  sandboxId: string,
): Promise<PlatformSandboxRead> {
  return apiClient<PlatformSandboxRead>(
    `/platform/sandboxes/${encodeURIComponent(sandboxId)}?${teamQuery(teamId)}`,
  )
}
