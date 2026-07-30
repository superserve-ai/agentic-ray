import { notFound } from "next/navigation"

import { ErrorState } from "@/components/error-state"
import { getPlatformBillingAction } from "@/lib/admin/billing-actions"
import { canReadPlatformBilling } from "@/lib/admin/permissions"
import { isStaff } from "@/lib/admin/staff"
import {
  PLATFORM_BILLING_SORT_COLUMNS,
  type PlatformBillingListParams,
  type PlatformBillingSortColumn,
} from "@/lib/api/platform-billing"
import { createServerClient } from "@/lib/supabase/server"

import { PlatformBillingPage } from "./platform-billing-page"

const DEFAULT_SORT: PlatformBillingSortColumn = "current_charges_usd"
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

type SearchParams = Record<string, string | string[] | undefined>

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseListParams(
  searchParams: SearchParams,
): PlatformBillingListParams {
  const page = Math.max(
    1,
    Math.trunc(Number(firstParam(searchParams.page)) || 1),
  )
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      Math.trunc(Number(firstParam(searchParams.size)) || DEFAULT_PAGE_SIZE),
    ),
  )
  const rawSort = firstParam(searchParams.sort)
  const sort =
    PLATFORM_BILLING_SORT_COLUMNS.find((column) => column === rawSort) ??
    DEFAULT_SORT
  const order = firstParam(searchParams.order) === "asc" ? "asc" : "desc"
  const search = firstParam(searchParams.search)?.trim() || undefined

  return {
    page,
    pageSize,
    sort,
    order,
    search,
  }
}

export default async function Page({
  searchParams = {},
}: {
  searchParams?: SearchParams | Promise<SearchParams>
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !isStaff(user) || !canReadPlatformBilling(user)) {
    notFound()
  }

  const params = parseListParams(await Promise.resolve(searchParams))

  try {
    const summary = await getPlatformBillingAction(params)
    return (
      <PlatformBillingPage
        summary={summary}
        page={params.page}
        pageSize={params.pageSize}
        sort={params.sort}
        order={params.order}
        search={params.search ?? ""}
      />
    )
  } catch (error) {
    return (
      <ErrorState
        title="Platform Billing unavailable"
        message={
          error instanceof Error
            ? error.message
            : "The platform billing page could not be loaded."
        }
      />
    )
  }
}
