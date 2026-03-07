"use client"

import { usePostHog } from "posthog-js/react"
import { Badge, Button, Card } from "@superserve/ui"

interface Agent {
  id: string
  name: string
  created_at: string
}

interface StepPlaygroundProps {
  agents: Agent[]
  hasAgents: boolean
  loading: boolean
}

const PLAYGROUND_URL = "https://playground.superserve.ai"

export function StepPlayground({
  agents,
  hasAgents,
  loading,
}: StepPlaygroundProps) {
  const posthog = usePostHog()
  if (!hasAgents) {
    return (
      <div className="px-4 pb-6 pt-6">
        <div className="flex items-center gap-3 text-muted text-sm">
          {loading ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>Checking for deployed agents...</span>
            </>
          ) : (
            <>
              <div className="relative mr-4 mb-2">
                <div className="absolute inset-0 h-3 w-3 rounded-full bg-muted/30 animate-ping" />
                <div className="absolute inset-0 h-3 w-3 rounded-full bg-muted/30" />
              </div>
              <div>
                <p className="mb-1.5">Waiting for your first deploy&hellip;</p>
                <p className="text-xs">
                 Once you run{" "}
                  <code className="font-mono text-xs bg-black/5 px-1 py-0.5">
                    superserve deploy
                  </code>
                  , your agent will appear here automatically.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pb-6 pt-2 space-y-4 animate-fade-in">
      <p className="text-sm font-medium text-foreground">
        Your agent is live!
      </p>

      <div className="space-y-3">
        {agents.map((agent) => (
          <Card
            key={agent.id}
            className="flex items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <Badge variant="success" dot>
                Live
              </Badge>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {agent.name}
                </p>
                <p className="text-xs text-muted">
                  {new Date(agent.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (posthog) {
                  posthog.capture("playground_agent_opened", {
                    agent_id: agent.id,
                    agent_name: agent.name,
                  })
                }
                window.open(
                  `${PLAYGROUND_URL}/agents/${agent.id}/`,
                  "_blank",
                )
              }}
            >
              Open in Playground
            </Button>
          </Card>
        ))}
      </div>
    </div>
  )
}
