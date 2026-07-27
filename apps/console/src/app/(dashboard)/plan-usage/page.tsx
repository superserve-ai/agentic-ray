import type { Metadata } from "next"

import { PlanUsagePageClient } from "./page-client"

export const metadata: Metadata = {
  title: "Billing & Usage",
}

export default function PlanUsagePage() {
  return <PlanUsagePageClient />
}
