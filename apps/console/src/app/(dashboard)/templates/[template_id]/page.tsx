import { notFound } from "next/navigation"

import { canReadPlatformTemplates } from "@/lib/admin/permissions"
import { createServerClient } from "@/lib/supabase/server"

import TemplateDetailPageClient from "./template-detail-page-client"

export default async function TemplateDetailPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!canReadPlatformTemplates(user)) {
    notFound()
  }

  return <TemplateDetailPageClient />
}
