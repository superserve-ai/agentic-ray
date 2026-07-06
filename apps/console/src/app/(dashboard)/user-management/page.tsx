import { notFound } from "next/navigation"

import { canViewOtherUsersAccount } from "@/lib/admin/permissions"
import { createServerClient } from "@/lib/supabase/server"

import { UserManagementClient } from "./user-management-client"

export default async function UserManagementPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!canViewOtherUsersAccount(user)) {
    notFound()
  }

  return <UserManagementClient />
}
