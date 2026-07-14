import { redirect } from "next/navigation"

import { createServerClient } from "@/lib/supabase/server"

import TemplateDetailPageClient from "./template-detail-page-client"

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ template_id: string }>
}) {
  const { template_id: templateId } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/auth/signin?next=/templates/${encodeURIComponent(templateId)}`)
  }

  return <TemplateDetailPageClient />
}
