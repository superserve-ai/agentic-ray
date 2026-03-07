"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"
import {
  Alert,
  Button,
  FormField,
  Input,
  Textarea,
  useToast,
} from "@superserve/ui"
import { createBrowserClient } from "@superserve/supabase"

import { sendEarlyAccessToSlack } from "./action"
import { useOnboardingState } from "../hooks/use-onboarding-state"
import { useAgents } from "../hooks/use-agents"
import { StepIndicator } from "../components/step-indicator"
import { StepInstall } from "../components/onboarding/step-install"
import { StepDeploy } from "../components/onboarding/step-deploy"
import { StepPlayground } from "../components/onboarding/step-playground"

const PLAYGROUND_URL = "https://playground.superserve.ai"

const STEP_LABELS = [
  "Install the CLI",
  "Deploy your agent",
  "Try it on the Playground",
] as const

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState("")
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    role: "",
    useCase: "",
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const router = useRouter()
  const posthog = usePostHog()
  const { addToast } = useToast()

  const onboarding = useOnboardingState()
  const { agents, hasAgents, loading: agentsLoading } = useAgents(
    onboarding.isStepCompleted(1),
  )

  // Auto-complete step 2 and expand step 3 when agents are detected
  useEffect(() => {
    if (hasAgents && !onboarding.isStepCompleted(2)) {
      onboarding.completeStep(2)
      onboarding.completeStep(3)
      if (posthog) {
        posthog.capture("onboarding_agent_detected", {
          agent_count: agents.length,
        })
      }
    }
  }, [hasAgents]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auth check
  useEffect(() => {
    const checkUserAndSubmission = async () => {
      const supabase = createBrowserClient()
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (!authUser) {
        router.push("/auth/signin")
        return
      }

      const name =
        authUser.user_metadata?.full_name ||
        authUser.user_metadata?.name ||
        ""
      const email = authUser.email || ""

      setUserId(authUser.id)
      setUserName(name.split(" ")[0] || "there")
      setFormData((prev) => ({ ...prev, name, email }))

      if (posthog) {
        posthog.identify(authUser.id, { email, name })
      }

      // If user already has agents, redirect to playground
      try {
        const { data: existingAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", authUser.id)
          .limit(1)

        if (existingAgents && existingAgents.length > 0) {
          window.location.href = PLAYGROUND_URL
          return
        }
      } catch (err) {
        console.error("Error checking agents:", err)
      }

      try {
        const { data } = await supabase
          .from("early_access_requests")
          .select("id")
          .eq("user_id", authUser.id)
          .maybeSingle()

        if (data) {
          setIsSubmitted(true)
        }
      } catch (err) {
        console.error("Error checking submission status:", err)
      }

      setLoading(false)
    }

    checkUserAndSubmission()
  }, [router, posthog])

  // Early access form handlers
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) return

    setIsSubmitting(true)
    setError(null)

    try {
      const supabase = createBrowserClient()
      const { error: upsertError } = await supabase
        .from("early_access_requests")
        .upsert(
          {
            user_id: userId,
            name: formData.name,
            email: formData.email,
            company: formData.company,
            role: formData.role,
            use_case: formData.useCase,
          },
          { onConflict: "user_id" },
        )

      if (upsertError) {
        throw new Error(upsertError.message)
      }

      sendEarlyAccessToSlack(
        formData.name,
        formData.email,
        formData.company,
        formData.role,
        formData.useCase,
      ).catch(() => {})

      if (posthog) {
        posthog.capture("early_access_submitted", {
          company: formData.company,
          role: formData.role,
        })
      }

      setIsSubmitted(true)
      addToast("Request submitted successfully!", "success")
    } catch (err) {
      console.error("Error submitting form:", err)
      setError(
        err instanceof Error
          ? err.message
          : "Failed to submit. Please try again.",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }))
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen relative bg-background flex flex-col">
      <div className="relative z-10 container mx-auto px-6 lg:px-8 py-12 lg:py-20 flex-1">
        <div className="max-w-2xl mx-auto">
          {/* Logo */}
          <div className="mb-12">
            <Link href="/">
              <img src="/logo.svg" alt="Superserve" className="h-8 w-auto" />
            </Link>
          </div>

          {/* Welcome */}
          <div className="mb-10 animate-fade-in">
            <h1 className="font-display text-3xl lg:text-4xl tracking-tight font-semibold mb-2 text-foreground">
              Welcome, {userName}
            </h1>
            <p className="text-muted">
              Deploy your first agent to Superserve.
            </p>
          </div>

          {/* Onboarding Steps */}
          <div className="mb-16 space-y-1 animate-fade-in">
            {STEP_LABELS.map((label, i) => {
              const step = (i + 1) as 1 | 2 | 3
              const completed = onboarding.isStepCompleted(step)
              const active = onboarding.expandedStep === step

              return (
                <div key={step}>
                  <StepIndicator
                    step={step}
                    label={label}
                    completed={completed}
                    active={active}
                    onClick={() => {
                      onboarding.toggleStep(step)
                      if (posthog) {
                        posthog.capture("onboarding_step_toggled", {
                          step,
                          label,
                        })
                      }
                    }}
                  />

                  {active && step === 1 && (
                    <StepInstall
                      onComplete={() => {
                        onboarding.completeStep(1)
                        if (posthog) {
                          posthog.capture("onboarding_step_completed", {
                            step: 1,
                          })
                        }
                      }}
                    />
                  )}

                  {active && step === 2 && (
                    <StepDeploy
                      agentPath={onboarding.agentPath}
                      framework={onboarding.framework}
                      onSelectPath={(path) => {
                        onboarding.setAgentPath(path)
                        if (posthog && path) {
                          posthog.capture("onboarding_path_selected", {
                            path,
                          })
                        }
                      }}
                      onSelectFramework={(fw) => {
                        onboarding.setFramework(fw)
                        if (posthog) {
                          posthog.capture("onboarding_framework_selected", {
                            framework: fw,
                          })
                        }
                      }}
                      onSkip={() => {
                        onboarding.completeStep(2)
                        if (posthog) {
                          posthog.capture("onboarding_deploy_skipped")
                        }
                      }}
                    />
                  )}

                  {active && step === 3 && (
                    <StepPlayground
                      agents={agents}
                      hasAgents={hasAgents}
                      loading={agentsLoading}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-dashed border-border mb-8" />

          {/* Early access + Talk to us */}
          <div className="space-y-6">
            {!showForm ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-muted text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(true)
                    if (posthog) {
                      posthog.capture("dashboard_access_form_opened")
                    }
                  }}
                  className="hover:text-foreground transition-colors text-left"
                >
                  Looking to manage agents with your team?{" "}
                  <span className="text-primary hover:underline">
                    Request dashboard access
                  </span>
                </button>
                <span className="hidden sm:inline text-border">|</span>
                <a
                  href="https://calendly.com/superserve-ai/25-min"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Schedule a call
                </a>
              </div>
            ) : isSubmitted ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-muted text-sm">
                <p>
                  We&apos;ve already received your request for dashboard access.
                  We&apos;ll send you an update shortly.
                </p>
                <span className="hidden sm:inline text-border">|</span>
                <a
                  href="https://calendly.com/superserve-ai/25-min"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline shrink-0"
                >
                  Schedule a call
                </a>
              </div>
            ) : (
              <div className="animate-fade-in">
                <h2 className="font-display text-2xl tracking-tight font-semibold mb-2 text-foreground">
                  Request dashboard access
                </h2>
                <p className="text-muted text-sm mb-8">
                  Get access to team management, monitoring, and more.
                </p>

                <form onSubmit={handleSubmit} className="space-y-8">
                  <div className="space-y-5">
                    <div className="grid sm:grid-cols-2 gap-5">
                      <FormField label="Full name" required>
                        <Input
                          type="text"
                          name="name"
                          required
                          value={formData.name}
                          onChange={handleChange}
                          placeholder="Jane Doe"
                        />
                      </FormField>

                      <FormField label="Email" required>
                        <Input
                          type="email"
                          name="email"
                          required
                          value={formData.email}
                          onChange={handleChange}
                          placeholder="jane@company.com"
                        />
                      </FormField>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-5">
                      <FormField label="Company">
                        <Input
                          type="text"
                          name="company"
                          value={formData.company}
                          onChange={handleChange}
                          placeholder="Acme Inc."
                        />
                      </FormField>

                      <FormField label="Role">
                        <Input
                          type="text"
                          name="role"
                          value={formData.role}
                          onChange={handleChange}
                          placeholder="Founding Engineer"
                        />
                      </FormField>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <FormField
                      label="Tell us in a few words about your use case"
                      required
                    >
                      <Textarea
                        name="useCase"
                        required
                        value={formData.useCase}
                        onChange={handleChange}
                        placeholder="I want to deploy an MCP server and an AI agent that does ..."
                        rows={4}
                        className="resize-none"
                      />
                    </FormField>
                  </div>

                  <div className="pt-2 flex items-center gap-6">
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? (
                        <>
                          <div className="h-5 w-5 animate-spin border-2 border-white border-t-transparent rounded-full" />
                          Sending...
                        </>
                      ) : (
                        <>
                          Request Access
                          <svg
                            className="w-5 h-5 transition-transform group-hover:translate-x-1"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 7l5 5m0 0l-5 5m5-5H6"
                            />
                          </svg>
                        </>
                      )}
                    </Button>

                    <a
                      href="https://calendly.com/superserve-ai/25-min"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      Schedule a call
                    </a>
                  </div>

                  {error && (
                    <Alert variant="destructive">
                      {error}
                    </Alert>
                  )}
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
