import { redirect } from "next/navigation"

import { createServerClient } from "@/lib/supabase/server"

import TemplatesPageClient from "./templates-page-client"

export default async function TemplatesPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/signin?next=/templates")
  }

  return <TemplatesPageClient />
}
