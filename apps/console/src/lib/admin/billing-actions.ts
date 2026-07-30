"use server"

import { canReadPlatformBilling } from "@/lib/admin/permissions"
import { isStaff } from "@/lib/admin/staff"
import { listPlatformBillingPaged } from "@/lib/api/platform-billing"
import type {
  PlatformBillingListParams,
  PlatformBillingSummary,
} from "@/lib/api/platform-billing"
import { createServerClient } from "@/lib/supabase/server"

async function requirePlatformBillingRead() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !isStaff(user) || !canReadPlatformBilling(user)) {
    throw new Error("Forbidden: platform billing read access required")
  }

  return user
}

export async function getPlatformBillingAction(
  params: PlatformBillingListParams,
): Promise<PlatformBillingSummary> {
  await requirePlatformBillingRead()
  return listPlatformBillingPaged(params)
}
