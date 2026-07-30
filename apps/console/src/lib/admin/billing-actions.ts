"use server"

import { cookies, headers } from "next/headers"

import { canReadPlatformBilling } from "@/lib/admin/permissions"
import { isStaff } from "@/lib/admin/staff"
import {
  platformBillingListQuery,
  type PlatformBillingListParams,
  type PlatformBillingSummary,
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

async function getConsoleOrigin(): Promise<string> {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configuredOrigin) return configuredOrigin

  const requestHeaders = await headers()
  const host = requestHeaders.get("host")
  if (!host) {
    throw new Error("Unable to determine console origin for platform billing")
  }

  const proto = requestHeaders.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}`
}

async function getCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ")
  return cookieHeader || undefined
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as
      | { error?: { code?: string; message?: string } }
      | { message?: string }
      | null
    if (body && typeof body === "object") {
      if ("error" in body && body.error?.message) {
        return body.error.message
      }
      if ("message" in body && body.message) {
        return body.message
      }
    }
  } catch {
    // Fall through to the default status text.
  }

  return response.statusText || "Platform billing request failed"
}

async function listPlatformBillingPaged(
  params: PlatformBillingListParams,
): Promise<PlatformBillingSummary> {
  const origin = await getConsoleOrigin()
  const url = new URL("/api/internal/billing/", origin)
  url.search = platformBillingListQuery(params)

  const cookie = await getCookieHeader()
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return response.json() as Promise<PlatformBillingSummary>
}

export async function getPlatformBillingAction(
  params: PlatformBillingListParams,
): Promise<PlatformBillingSummary> {
  await requirePlatformBillingRead()
  return listPlatformBillingPaged(params)
}
