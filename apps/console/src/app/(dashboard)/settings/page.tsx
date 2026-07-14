"use client"

import { Button, Field, Input, Separator, useToast } from "@superserve/ui"
import Link from "next/link"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

import { GoogleIcon, Spinner } from "@/components/icons"
import { PageHeader } from "@/components/page-header"
import { TeamsSection } from "@/components/settings/teams-section"
import { useBillingSettings } from "@/hooks/use-billing-usage"
import { useUser } from "@/hooks/use-user"
import { SETTINGS_EVENTS } from "@/lib/posthog/events"
import { createBrowserClient } from "@/lib/supabase/client"

function formatRate(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.001 ? 6 : 4,
    maximumFractionDigits: value < 0.001 ? 6 : 4,
  }).format(value)
}

export default function SettingsPage() {
  const { user, loading } = useUser()
  const { data: billingSettings } = useBillingSettings()
  const posthog = usePostHog()
  const { addToast } = useToast()

  const [name, setName] = useState("")
  const [nameLoaded, setNameLoaded] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (user && !nameLoaded) {
      setName(user.user_metadata?.full_name || user.user_metadata?.name || "")
      setNameLoaded(true)
    }
  }, [user, nameLoaded])

  const email = user?.email || ""
  const isOAuth = user?.app_metadata?.provider === "google"

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const supabase = createBrowserClient()
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name },
      })
      if (error) throw error
      posthog.capture(SETTINGS_EVENTS.PROFILE_UPDATED)
      addToast("Profile updated", "success")
    } catch {
      addToast("Failed to update profile", "error")
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword) {
      addToast("Current password is required", "error")
      return
    }
    if (newPassword !== confirmPassword) {
      addToast("Passwords do not match", "error")
      return
    }
    if (newPassword.length < 8) {
      addToast("Password must be at least 8 characters", "error")
      return
    }
    setSavingPassword(true)
    try {
      const supabase = createBrowserClient()
      // Verify current password by re-authenticating
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      })
      if (signInError) {
        addToast("Current password is incorrect", "error")
        return
      }
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })
      if (error) throw error
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      posthog.capture(SETTINGS_EVENTS.PASSWORD_CHANGED)
      addToast("Password updated", "success")
    } catch {
      addToast("Failed to update password", "error")
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Settings" />
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="border-foreground/20 border-t-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />

      <div className="flex-1 overflow-y-auto">
        {/* Profile */}
        <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
          <div>
            <h2 className="text-base font-medium text-foreground">Profile</h2>
            <p className="mt-1 text-xs text-muted">
              Your personal account details.
            </p>
          </div>
          <div className="max-w-md space-y-5">
            <Field label="Full Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
              />
            </Field>
            <Field label="Email">
              <Input value={email} disabled />
            </Field>
            <div>
              <Button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                size="sm"
              >
                {savingProfile ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* Password / Auth */}
        <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
          <div>
            <h2 className="text-base font-medium text-foreground">
              {isOAuth ? "Authentication" : "Password"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {isOAuth
                ? "Your authentication method."
                : "Update your account password."}
            </p>
          </div>
          <div className="max-w-md space-y-5">
            {isOAuth ? (
              <div className="flex items-center gap-3 border border-border px-4 py-3">
                <GoogleIcon />
                <span className="text-sm text-foreground">
                  Signed in with Google
                </span>
              </div>
            ) : (
              <>
                <Field label="Current Password">
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
                <Field label="New Password">
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
                <Field label="Confirm New Password">
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
                <div>
                  <Button
                    onClick={handleChangePassword}
                    disabled={
                      savingPassword ||
                      !currentPassword ||
                      !newPassword ||
                      !confirmPassword
                    }
                    size="sm"
                  >
                    {savingPassword ? "Updating..." : "Update Password"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        <Separator />

        {/* Renders nothing unless a second cell (region) is configured */}
        <TeamsSection />

        {billingSettings?.enabled && (
          <>
            {/* Billing */}
            <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
              <div>
                <h2 className="text-base font-medium text-foreground">
                  Billing
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Plan, pricing, and usage estimates.
                </p>
              </div>
              <div className="max-w-xl space-y-5">
                <div className="border border-border px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Usage-based billing
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        Your team has billing enabled. Usage is metered from
                        active vCPU seconds, active GiB memory seconds, and GiB
                        storage seconds.
                      </p>
                    </div>
                    <span className="bg-brand/10 px-2 py-1 font-mono text-xs text-brand uppercase">
                      Active
                    </span>
                  </div>
                  <dl className="mt-4 grid gap-3 font-mono text-xs md:grid-cols-3">
                    <div>
                      <dt className="text-muted uppercase">Compute</dt>
                      <dd className="mt-1 text-foreground">
                        {formatRate(
                          billingSettings.pricing?.cpu_vcpu_hour_usd ?? 0,
                        )}{" "}
                        / vCPU-hour
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted uppercase">Memory</dt>
                      <dd className="mt-1 text-foreground">
                        {formatRate(
                          billingSettings.pricing?.memory_gib_hour_usd ?? 0,
                        )}{" "}
                        / GiB-hour
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted uppercase">Storage</dt>
                      <dd className="mt-1 text-foreground">
                        {formatRate(
                          billingSettings.pricing?.storage_gib_hour_usd ?? 0,
                        )}{" "}
                        / GiB-hour
                      </dd>
                    </div>
                  </dl>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href="/plan-usage" />}
                >
                  View Usage
                </Button>
              </div>
            </div>

            <Separator />
          </>
        )}

        {/* Danger Zone */}
        <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
          <div>
            <h2 className="text-base font-medium text-destructive">
              Danger Zone
            </h2>
            <p className="mt-1 text-xs text-muted">Irreversible actions.</p>
          </div>
          <div className="max-w-md">
            <p className="text-xs leading-loose text-muted">
              To delete your account and all associated data, please contact us
              at{" "}
              <a
                href="mailto:support@superserve.ai"
                className="text-foreground underline underline-offset-4 hover:text-primary"
              >
                support@superserve.ai
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
