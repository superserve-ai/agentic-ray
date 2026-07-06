import { apiClient } from "./client"

export type TeamMemberStatus = "active" | "inactive" | "invited"

export interface TeamManagementCapabilities {
  can_view_role_assignments: boolean
  can_invite_members: boolean
  can_deactivate_members: boolean
  can_assign_roles: boolean
  can_revoke_roles: boolean
}

export interface TeamMember {
  user_id: string
  email: string
  full_name?: string | null
  status: TeamMemberStatus
  roles?: string[]
  created_at: string
  updated_at: string
}

export interface TeamRoleAssignment {
  assignment_id: string
  user_id: string
  email: string
  role_name: string
  scope_type: "team"
  team_id: string
  granted_by?: string | null
  granted_at: string
  revoked_at?: string | null
  created_at: string
  updated_at: string
}

export interface TeamManagementMutationOptions {
  member_statuses?: Array<"active" | "invited">
  assignable_roles?: string[]
}

export interface TeamManagementResponse {
  team_id: string
  members: TeamMember[]
  assignments: TeamRoleAssignment[]
  capabilities: TeamManagementCapabilities
  mutation_options?: TeamManagementMutationOptions
}

export interface AddTeamMemberRequest {
  user_id: string
  status?: "active" | "invited"
}

export interface AssignTeamRoleRequest {
  user_id: string
  role_name: string
}

export async function getTeamManagement(): Promise<TeamManagementResponse> {
  return apiClient<TeamManagementResponse>("/team-management")
}

export async function addTeamMember(data: AddTeamMemberRequest): Promise<void> {
  await apiClient<void>("/team-management/members", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function deactivateTeamMember(userId: string): Promise<void> {
  await apiClient<void>(
    `/team-management/members/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    },
  )
}

export async function assignTeamRole(
  data: AssignTeamRoleRequest,
): Promise<void> {
  await apiClient<void>("/team-management/roles", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function revokeTeamRole(assignmentId: string): Promise<void> {
  await apiClient<void>(
    `/team-management/roles/${encodeURIComponent(assignmentId)}`,
    {
      method: "DELETE",
    },
  )
}
