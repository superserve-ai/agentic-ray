"use client"

import { Alert, Button, Card } from "@superserve/ui"
import type { AgentPath, Framework } from "../../hooks/use-onboarding-state"
import { CodeBlock } from "../code-block"
import { FrameworkPicker, FRAMEWORKS } from "../framework-picker"

interface StepDeployProps {
  agentPath: AgentPath
  framework: Framework
  onSelectPath: (path: AgentPath) => void
  onSelectFramework: (fw: Framework & string) => void
  onSkip: () => void
}

export function StepDeploy({
  agentPath,
  framework,
  onSelectPath,
  onSelectFramework,
  onSkip,
}: StepDeployProps) {
  const selectedFramework = FRAMEWORKS.find((fw) => fw.id === framework)

  return (
    <div className="px-4 pb-6 pt-2 space-y-6">
      {/* Path selection */}
      {!agentPath && (
        <div className="flex flex-col sm:flex-row gap-3">
          <Card
            className="flex-1 px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
            onClick={() => onSelectPath("own")}
          >
            <p className="text-sm font-medium text-foreground">I have an agent</p>
            <p className="text-xs text-muted mt-0.5">Deploy your own agent code</p>
          </Card>
          <Card
            className="flex-1 px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
            onClick={() => onSelectPath("example")}
          >
            <p className="text-sm font-medium text-foreground">Use an example</p>
            <p className="text-xs text-muted mt-0.5">Start with a sample agent</p>
          </Card>
        </div>
      )}

      {/* Path A: Own agent */}
      {agentPath === "own" && (
        <div className="space-y-4 animate-fade-in">
          <p className="text-muted text-sm mt-2">
            Deploy your agent with a single command:
          </p>

          <CodeBlock
            command="superserve deploy agent.py"
            eventName="deploy_command_copied"
          />

          <Alert variant="default" title="Agent contract">
            Your agent must read from <code className="font-mono text-xs bg-black/5 px-1 py-0.5">stdin</code> and
            write to <code className="font-mono text-xs bg-black/5 px-1 py-0.5">stdout</code>.
            Superserve sends user messages via stdin and reads agent responses
            from stdout.
            <br /><br />
            If your agent needs API keys or secrets:
            <br />
            <code className="font-mono text-xs">
              superserve secrets set &lt;agent&gt; KEY=value
            </code>
          </Alert>
        </div>
      )}

      {/* Path B: Example agent */}
      {agentPath === "example" && (
        <div className="space-y-6 animate-fade-in">
          <div className="space-y-3">
            <p className="text-muted text-sm mt-3">Pick a framework:</p>
            <FrameworkPicker
              selected={framework}
              onSelect={onSelectFramework}
            />
          </div>

          {selectedFramework && (
            <div className="space-y-4 animate-fade-in">
              <p className="text-muted text-sm">
                Clone the example and deploy:
              </p>

              <div className="space-y-3">
                <CodeBlock
                  command="git clone https://github.com/superserve-ai/superserve"
                  eventName="clone_command_copied"
                />
                <CodeBlock
                  command={`cd superserve/examples/${selectedFramework.id}`}
                  eventName="cd_command_copied"
                />
                <CodeBlock
                  command={`superserve deploy ${selectedFramework.file} --name chatbot`}
                  eventName="deploy_example_command_copied"
                />
              </div>

              <p className="text-muted text-sm">Set the required secret:</p>

              <CodeBlock
                command={`superserve secrets set chatbot ${selectedFramework.secretEnvName}=your-key-here`}
                eventName="secrets_command_copied"
              />
            </div>
          )}
        </div>
      )}

      {/* Mark as done / change path */}
      {agentPath && (
        <div className="flex items-center gap-4 pt-2">
          <Button
            size="sm"
            onClick={onSkip}
            disabled={agentPath === "example" && !framework}
          >
            Mark as done
          </Button>
          <Button
            variant="link"
            size="sm"
            onClick={() => onSelectPath(null)}
          >
            Change selection
          </Button>
        </div>
      )}
    </div>
  )
}
