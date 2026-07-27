import type { User } from "@supabase/supabase-js"

import { isStaff } from "./staff"

export const PLATFORM_SANDBOX_READ_PERMISSION = "platform:sandbox:read"
export const PLATFORM_TEMPLATE_READ_PERMISSION = "platform:template:read"
export const PLATFORM_ACTIVITY_READ_PERMISSION = "platform:activity:read"
export const PLATFORM_BILLING_READ_PERMISSION = "platform:billing:read"
export const PLATFORM_TEAMS_READ_PERMISSION = "platform:teams:read"
export type PlatformImpersonationReadScope =
  | typeof PLATFORM_SANDBOX_READ_PERMISSION
  | typeof PLATFORM_TEMPLATE_READ_PERMISSION
  | typeof PLATFORM_ACTIVITY_READ_PERMISSION
  | typeof PLATFORM_BILLING_READ_PERMISSION

function asPermissions(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function userPermissions(user: User | null | undefined): string[] {
  if (!user) return []

  const appMetadata = user.app_metadata as Record<string, unknown> | undefined

  const permissions = new Set<string>([
    ...asPermissions(appMetadata?.permissions),
    ...asPermissions(
      (appMetadata?.authorization as Record<string, unknown> | undefined)
        ?.permissions,
    ),
  ])

  return [...permissions]
}

function hasPermission(
  user: User | null | undefined,
  permission: string,
): boolean {
  return userPermissions(user).includes(permission)
}

export function canReadPlatformSandboxes(
  user: User | null | undefined,
): boolean {
  return hasPermission(user, PLATFORM_SANDBOX_READ_PERMISSION)
}

export function canReadPlatformTemplates(
  user: User | null | undefined,
): boolean {
  return hasPermission(user, PLATFORM_TEMPLATE_READ_PERMISSION)
}

export function canReadPlatformActivity(
  user: User | null | undefined,
): boolean {
  return hasPermission(user, PLATFORM_ACTIVITY_READ_PERMISSION)
}

export function canReadPlatformBilling(user: User | null | undefined): boolean {
  return hasPermission(user, PLATFORM_BILLING_READ_PERMISSION)
}

export function canReadPlatformTeams(user: User | null | undefined): boolean {
  return isStaff(user) && hasPermission(user, PLATFORM_TEAMS_READ_PERMISSION)
}

export function platformImpersonationReadScopes(
  user: User | null | undefined,
): PlatformImpersonationReadScope[] {
  const scopes: PlatformImpersonationReadScope[] = []

  if (canReadPlatformSandboxes(user)) {
    scopes.push(PLATFORM_SANDBOX_READ_PERMISSION)
  }
  if (canReadPlatformTemplates(user)) {
    scopes.push(PLATFORM_TEMPLATE_READ_PERMISSION)
  }
  if (canReadPlatformActivity(user)) {
    scopes.push(PLATFORM_ACTIVITY_READ_PERMISSION)
  }
  if (canReadPlatformBilling(user)) {
    scopes.push(PLATFORM_BILLING_READ_PERMISSION)
  }

  return scopes
}

export function canStartPlatformImpersonation(
  user: User | null | undefined,
): boolean {
  return isStaff(user) && platformImpersonationReadScopes(user).length > 0
}

export function canViewOtherUsersAccount(
  user: User | null | undefined,
): boolean {
  return canReadPlatformTeams(user)
}
