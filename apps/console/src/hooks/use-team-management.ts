"use client"

import { useToast } from "@superserve/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import {
  assignTeamRole,
  getTeamManagement,
  revokeTeamRole,
  type AssignTeamRoleRequest,
} from "@/lib/api/team-management"

const teamManagementKeys = {
  all: ["team-management"] as const,
}

function friendlyRbacMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) {
    return fallback
  }

  if (error.status === 403) {
    return "You do not have permission to perform this team-management action."
  }
  if (error.status === 404) {
    return "That member, role assignment, or team could not be found. Refresh and try again."
  }
  if (error.status === 409) {
    return "This change conflicts with the current team state. If you are changing owners, make sure at least one active owner remains."
  }

  return error.message
}

export function useTeamManagement() {
  return useQuery({
    queryKey: teamManagementKeys.all,
    queryFn: getTeamManagement,
  })
}

export function useAssignTeamRole() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: AssignTeamRoleRequest) => assignTeamRole(data),
    onSuccess: () => {
      addToast("Role assigned", "success")
    },
    onError: (error) => {
      addToast(friendlyRbacMessage(error, "Failed to assign role."), "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: teamManagementKeys.all })
    },
  })
}

export function useRevokeTeamRole() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (assignmentId: string) => revokeTeamRole(assignmentId),
    onSuccess: () => {
      addToast("Role revoked", "success")
    },
    onError: (error) => {
      addToast(friendlyRbacMessage(error, "Failed to revoke role."), "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: teamManagementKeys.all })
    },
  })
}
