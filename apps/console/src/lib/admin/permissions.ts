import type { User } from "@supabase/supabase-js"

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

function userPermissions(user: User | null | undefined): string[] {
  const permissions = user?.app_metadata?.permissions
  return Array.isArray(permissions) ? (permissions as string[]) : []
}

export function canViewOtherUsersAccount(
  user: User | null | undefined,
): boolean {
  return (
    isGoogleStaffUser(user) &&
    userPermissions(user).includes(PLATFORM_TEAMS_READ_PERMISSION)
  )
}
