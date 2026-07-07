import type { User } from "@supabase/supabase-js"

const PLATFORM_SANDBOX_READ_PERMISSION = "platform:sandbox:read"
const PLATFORM_SANDBOXES_READ_PERMISSION = "platform:sandboxes:read"
const PLATFORM_TEAMS_READ_PERMISSION = "platform:teams:read"
const DEFAULT_STAFF_DOMAIN = "superserve.ai"

function staffDomain(): string {
  return (process.env.STAFF_EMAIL_DOMAIN ?? DEFAULT_STAFF_DOMAIN).toLowerCase()
}

function isGoogleStaffUser(user: User | null | undefined): boolean {
  if (!user?.email) return false
  const provider = user.app_metadata?.provider as string | undefined
  const providers = user.app_metadata?.providers as string[] | undefined
  const viaGoogle =
    provider === "google" ||
    (Array.isArray(providers) && providers.includes("google"))
  if (!viaGoogle) return false
  return user.email.toLowerCase().endsWith(`@${staffDomain()}`)
}

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

export function canReadPlatformSandboxes(
  user: User | null | undefined,
): boolean {
  const permissions = userPermissions(user)
  return (
    permissions.includes(PLATFORM_SANDBOX_READ_PERMISSION) ||
    permissions.includes(PLATFORM_SANDBOXES_READ_PERMISSION) ||
    permissions.includes(PLATFORM_TEAMS_READ_PERMISSION)
  )
}

export function canViewOtherUsersAccount(
  user: User | null | undefined,
): boolean {
  return (
    isGoogleStaffUser(user) &&
    userPermissions(user).includes(PLATFORM_TEAMS_READ_PERMISSION)
  )
}
