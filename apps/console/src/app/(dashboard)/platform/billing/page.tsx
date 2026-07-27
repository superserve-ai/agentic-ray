import { notFound } from "next/navigation"

import { getPlatformBillingAction } from "@/lib/admin/billing-actions"
import { canReadPlatformBilling } from "@/lib/admin/permissions"
import { isStaff } from "@/lib/admin/staff"
import { createServerClient } from "@/lib/supabase/server"

import { PlatformBillingPage } from "./platform-billing-page"

export default async function Page() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !isStaff(user) || !canReadPlatformBilling(user)) {
    notFound()
  }

  return <PlatformBillingPage summary={await getPlatformBillingAction()} />
}
