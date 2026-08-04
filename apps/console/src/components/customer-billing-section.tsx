"use client"

import {
  ArrowSquareOutIcon,
  CreditCardIcon,
  SpinnerGapIcon,
  WalletIcon,
} from "@phosphor-icons/react"
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
  cn,
  useToast,
} from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { formatCurrency, formatPeriodDate } from "@/components/billing-summary"
import { useCustomerBillingPeriods } from "@/hooks/use-customer-billing"
import type {
  BillingSummaryResponse,
  BillingSummaryResource,
} from "@/lib/api/billing"
import {
  createStripeCheckoutSession,
  createStripeCustomerPortalSession,
} from "@/lib/api/billing-stripe"
import { billingKeys } from "@/lib/api/query-keys"

interface CustomerBillingSectionProps {
  teamId: string
  teamRegion: string
  teamName: string
  summary: BillingSummaryResponse | null | undefined
}

function formatPeriodRange(start: string, end: string): string {
  return `${formatPeriodDate(start)} - ${formatPeriodDate(end)}`
}

function formatMetric(value: number, suffix: string): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)} ${suffix}`
}

function statusTone(
  status: string,
): "default" | "success" | "warning" | "muted" {
  if (status === "active" || status === "exported" || status === "paid") {
    return "success"
  }
  if (status === "pending" || status === "processing") {
    return "warning"
  }
  return "muted"
}

function friendlyPeriodStatus(status: string): string {
  if (status === "active" || status === "exported" || status === "approved") {
    return "Live"
  }
  if (status === "validating") {
    return "Under review"
  }
  if (status === "pending" || status === "processing") {
    return "Pending"
  }
  return status
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")
}

function billingModeCopy(
  mode: BillingSummaryResponse["billing_mode"] | null | undefined,
) {
  if (mode === "shadow") {
    return {
      title: "Usage is being tracked but you are not being charged",
      message:
        "Billing is in shadow mode. Stripe is not invoicing this team yet.",
      variant: "warning" as const,
    }
  }

  if (mode === "live") {
    return {
      title: "Billing is live",
      message: "Usage is being exported to Stripe for invoicing.",
      variant: "success" as const,
    }
  }

  return null
}

function billingModeBadge(
  mode: BillingSummaryResponse["billing_mode"] | null | undefined,
) {
  if (mode === "shadow") {
    return {
      label: "Tracking only",
      variant: "muted" as const,
    }
  }

  return null
}

function noticeFromQuery(value: string | null) {
  if (value === "success") {
    return {
      variant: "default" as const,
      title: "Returned from Stripe",
      message: "Billing status is refreshing against the latest server state.",
    }
  }
  if (value === "cancel") {
    return {
      variant: "warning" as const,
      title: "Billing flow canceled",
      message:
        "No changes were made. You can reopen billing setup or the customer portal any time.",
    }
  }
  if (value === "portal-return") {
    return {
      variant: "default" as const,
      title: "Billing portal closed",
      message:
        "You returned from Stripe customer portal. Billing settings remain available here.",
    }
  }
  return null
}

function paymentSummary(
  summary:
    | {
        billing_mode?: "shadow" | "live"
        payment_setup_required?: boolean
        portal_available?: boolean
      }
    | null
    | undefined,
  period:
    | {
        stripe_subscription_id?: string
        stripe_subscription_status?: string
        stripe_invoice_status?: string
        cancel_at_period_end?: boolean
      }
    | null
    | undefined,
): {
  headline: string
  detail: string
} {
  if (summary?.payment_setup_required) {
    return {
      headline: "Payment setup required",
      detail: "Start checkout to connect Stripe for this team.",
    }
  }

  if (summary?.billing_mode === "shadow") {
    return {
      headline: "Tracked only",
      detail: "Usage is being tracked, but this team is not being charged yet.",
    }
  }

  if (summary?.portal_available) {
    if (period?.cancel_at_period_end) {
      return {
        headline: "Connected",
        detail:
          "Billing is scheduled to end at the close of the current period.",
      }
    }

    if (period?.stripe_invoice_status === "open") {
      return {
        headline: "Connected",
        detail: "Stripe is ready to invoice this team.",
      }
    }

    return {
      headline: "Connected",
      detail: period?.stripe_invoice_status
        ? `Invoice status: ${friendlyPeriodStatus(period.stripe_invoice_status)}`
        : "Stripe subscription details are available for this team.",
    }
  }

  return summary?.billing_mode === "live"
    ? {
        headline: "Billing unavailable",
        detail:
          "Billing is live, but no customer portal is currently available.",
      }
    : {
        headline: "Tracking only",
        detail: "Usage is tracked, but billing actions are not available yet.",
      }
}

function ResourceCard({ resource }: { resource: BillingSummaryResource }) {
  const billingLabel = resource.billable ? "Billed" : "Tracked only"
  const usageHours =
    resource.unit === "second"
      ? resource.resource === "memory" || resource.resource === "storage"
        ? resource.usage / 1024 / 3600
        : resource.usage / 3600
      : resource.usage

  return (
    <div className="border border-dashed border-border/70 bg-surface/40 px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">
            {resource.display_name}
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {formatMetric(usageHours, resource.display_unit)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {resource.billable
              ? `Charge: ${formatCurrency(resource.charge_usd)}`
              : "Tracked but not billed"}
          </p>
        </div>
        <Badge variant={billingLabel === "Tracked only" ? "muted" : "default"}>
          {billingLabel}
        </Badge>
      </div>
    </div>
  )
}

export function CustomerBillingSection({
  teamId,
  teamRegion,
  teamName,
  summary,
}: CustomerBillingSectionProps) {
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState<"checkout" | "portal" | null>(
    null,
  )
  const [notice, setNotice] = useState<ReturnType<typeof noticeFromQuery>>()

  const teamKey = `${teamRegion}:${teamId}`
  const periodsQuery = useCustomerBillingPeriods(teamId, teamKey)
  const latestPeriod = useMemo(() => {
    return (
      periodsQuery.data?.periods?.toSorted((a, b) => {
        const endDiff =
          new Date(b.period_end).getTime() - new Date(a.period_end).getTime()
        if (endDiff !== 0) return endDiff
        return (
          new Date(b.period_start).getTime() -
          new Date(a.period_start).getTime()
        )
      })[0] ?? null
    )
  }, [periodsQuery.data?.periods])

  const selectedPeriod = useMemo(() => {
    if (summary?.billing_period) {
      return summary.billing_period
    }
    if (latestPeriod) {
      return {
        start: latestPeriod.period_start,
        end: latestPeriod.period_end,
      }
    }
    return null
  }, [latestPeriod, summary?.billing_period])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const billingState = query.get("billing")
    setNotice(noticeFromQuery(billingState))
    if (billingState) {
      query.delete("billing")
      const nextUrl = new URL(window.location.href)
      nextUrl.search = query.toString()
      window.history.replaceState({}, "", nextUrl.toString())
      void queryClient.invalidateQueries({
        queryKey: billingKeys.all,
      })
    }
  }, [queryClient])

  const modeCopy = billingModeCopy(summary?.billing_mode)
  const canManageBilling = Boolean(summary?.permissions?.can_manage)
  const canOpenPortal = Boolean(summary?.portal_available)
  const canStartCheckout = Boolean(summary?.checkout_available)
  const billingActionAvailable = canOpenPortal || canStartCheckout

  const modeBadge = billingModeBadge(summary?.billing_mode)
  const manageLabel = canOpenPortal
    ? "Open Customer Portal"
    : canStartCheckout
      ? "Set Up Billing"
      : "Tracking only"

  const isActionDisabled =
    submitting !== null ||
    periodsQuery.isPending ||
    periodsQuery.isFetching ||
    !canManageBilling ||
    !billingActionAvailable

  const openSession = async () => {
    if (submitting) return

    const currentUrl = new URL(window.location.href)
    setSubmitting(canOpenPortal ? "portal" : "checkout")

    try {
      if (canOpenPortal) {
        const returnUrl = new URL(currentUrl)
        returnUrl.searchParams.set("billing", "portal-return")
        const session = await createStripeCustomerPortalSession({
          returnUrl: returnUrl.toString(),
        })
        window.location.assign(session.url)
        return
      }

      if (!canStartCheckout) {
        return
      }

      const successUrl = new URL(currentUrl)
      successUrl.searchParams.set("billing", "success")
      const cancelUrl = new URL(currentUrl)
      cancelUrl.searchParams.set("billing", "cancel")
      const session = await createStripeCheckoutSession({
        successUrl: successUrl.toString(),
        cancelUrl: cancelUrl.toString(),
      })
      window.location.assign(session.url)
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : "Failed to open Stripe",
        "error",
      )
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <section
      className="space-y-4 border border-border/70 bg-surface/40 p-4 shadow-sm shadow-black/5"
      data-testid="customer-billing-section"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">
              Billing & Payments
            </h3>
            {modeBadge ? (
              <Badge variant={modeBadge.variant}>{modeBadge.label}</Badge>
            ) : null}
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Manage payment details, see the current billing period, and review
            the team&apos;s charges for {teamName}.
          </p>
          <p className="text-xs text-muted">
            Billing period status:{" "}
            {latestPeriod?.status
              ? friendlyPeriodStatus(latestPeriod.status)
              : "Pending"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canManageBilling ? (
            <Button
              size="sm"
              onClick={() => void openSession()}
              disabled={isActionDisabled}
            >
              {submitting ? (
                <SpinnerGapIcon className="size-3.5 animate-spin" />
              ) : canOpenPortal ? (
                <ArrowSquareOutIcon className="size-3.5" />
              ) : (
                <CreditCardIcon className="size-3.5" />
              )}
              {submitting
                ? "Loading..."
                : periodsQuery.isPending || periodsQuery.isFetching
                  ? "Loading..."
                  : manageLabel}
            </Button>
          ) : summary ? (
            <p className="self-center text-xs text-muted">
              Billing is view-only for your role.
            </p>
          ) : null}
        </div>
      </div>

      {modeCopy && (
        <Alert variant={modeCopy.variant} title={modeCopy.title}>
          {modeCopy.message}
        </Alert>
      )}

      {notice && (
        <Alert variant={notice.variant} title={notice.title}>
          {notice.message}
        </Alert>
      )}

      {latestPeriod?.blocked_reason && (
        <Alert variant="warning" title="Billing setup pending">
          {latestPeriod.blocked_reason}
        </Alert>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="border-border/70 bg-background/60">
          <CardContent className="space-y-2 p-4">
            <p className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">
              Billing Period
            </p>
            <p className="text-sm font-medium text-foreground">
              {selectedPeriod
                ? formatPeriodRange(selectedPeriod.start, selectedPeriod.end)
                : "Waiting for billing data"}
            </p>
            <p className="text-xs text-muted">
              {latestPeriod?.status
                ? `Billing period status: ${latestPeriod.status}`
                : "Stripe has not created a billing period yet."}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-background/60">
          <CardContent className="space-y-2 p-4">
            <p className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">
              Payment Status
            </p>
            <p className="text-sm font-medium text-foreground">
              {paymentSummary(summary, latestPeriod).headline}
            </p>
            <p className="text-xs text-muted">
              {paymentSummary(summary, latestPeriod).detail}
            </p>
            {latestPeriod?.cancel_at_period_end && (
              <p className="text-xs text-muted">Cancel at period end: yes</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-background/60">
          <CardContent className="space-y-2 p-4">
            <p className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">
              Billing Charges
            </p>
            <p className="text-sm font-medium text-foreground">
              {summary
                ? formatCurrency(summary.current_charges_usd)
                : "Unavailable"}
            </p>
            <p className="text-xs text-muted">
              {summary
                ? `Credits remaining: ${formatCurrency(summary.credits_remaining_usd)}`
                : "The current statement will appear once billing data loads."}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-border/70 bg-background/60">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center gap-2">
              <WalletIcon className="size-4 text-muted" />
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  Resources
                </h4>
                <p className="text-xs text-muted">
                  Backend-driven resource rows for this billing period.
                </p>
              </div>
            </div>

            {summary?.resources?.length ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {summary.resources
                  .toSorted((a, b) => {
                    const sortDiff = a.sort_order - b.sort_order
                    if (sortDiff !== 0) return sortDiff
                    return a.resource_key.localeCompare(b.resource_key)
                  })
                  .map((resource) => (
                    <ResourceCard
                      key={resource.resource_key}
                      resource={resource}
                    />
                  ))}
              </div>
            ) : (
              <p className="text-sm text-muted">
                Resource metadata will appear after billing data is available.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-background/60">
          <CardContent className="space-y-4 p-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-foreground">
                Billing Periods
              </h4>
              <p className="text-xs text-muted">
                Recent customer billing periods for this team.
              </p>
            </div>

            <div className="space-y-2">
              {periodsQuery.isPending ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-12" />
                ))
              ) : periodsQuery.data?.periods.length ? (
                periodsQuery.data.periods.map((period) => (
                  <div
                    key={period.period_id}
                    className={cn(
                      "flex items-center justify-between gap-3 border border-dashed border-border/70 px-3 py-2.5",
                      latestPeriod?.period_id === period.period_id &&
                        "bg-brand/5",
                    )}
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm text-foreground">
                        {formatPeriodRange(
                          period.period_start,
                          period.period_end,
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {period.stripe_subscription_status
                          ? `Subscription ${friendlyPeriodStatus(
                              period.stripe_subscription_status,
                            )}`
                          : "Subscription status pending"}
                      </p>
                    </div>
                    <Badge variant={statusTone(period.status)}>
                      {friendlyPeriodStatus(period.status)}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">
                  No billing periods have been recorded yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
