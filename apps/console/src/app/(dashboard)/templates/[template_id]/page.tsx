import { redirect } from "next/navigation"

import { createServerClient } from "@/lib/supabase/server"

import TemplateDetailPageClient from "./template-detail-page-client"

export default async function TemplateDetailPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/signin?next=/templates")
  }

  return <TemplateDetailPageClient />
}
