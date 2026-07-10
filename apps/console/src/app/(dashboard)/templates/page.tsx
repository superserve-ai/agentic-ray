import { notFound } from "next/navigation"

import { canReadPlatformTemplates } from "@/lib/admin/permissions"
import { createServerClient } from "@/lib/supabase/server"

import TemplatesPageClient from "./templates-page-client"

export default async function TemplatesPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!canReadPlatformTemplates(user)) {
    notFound()
  }

  return <TemplatesPageClient />
}
