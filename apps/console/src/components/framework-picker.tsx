"use client"

import type { Framework } from "../hooks/use-onboarding-state"
import { cn } from "@superserve/ui"

interface FrameworkInfo {
  id: Framework & string
  name: string
  file: string
  secret: string
  secretEnvName: string
}

export const FRAMEWORKS: FrameworkInfo[] = [
  {
    id: "agno",
    name: "Agno",
    file: "agent.py",
    secret: "OPENAI_API_KEY",
    secretEnvName: "OPENAI_API_KEY",
  },
  {
    id: "claude-agent-sdk",
    name: "Claude Agent SDK",
    file: "agent.py",
    secret: "ANTHROPIC_API_KEY",
    secretEnvName: "ANTHROPIC_API_KEY",
  },
  {
    id: "langchain",
    name: "LangChain",
    file: "agent.py",
    secret: "OPENAI_API_KEY",
    secretEnvName: "OPENAI_API_KEY",
  },
  {
    id: "mastra",
    name: "Mastra",
    file: "agent.ts",
    secret: "OPENAI_API_KEY",
    secretEnvName: "OPENAI_API_KEY",
  },
  {
    id: "openai-agents-sdk",
    name: "OpenAI Agents SDK",
    file: "agent.py",
    secret: "OPENAI_API_KEY",
    secretEnvName: "OPENAI_API_KEY",
  },
  {
    id: "pydantic-ai",
    name: "Pydantic AI",
    file: "agent.py",
    secret: "OPENAI_API_KEY",
    secretEnvName: "OPENAI_API_KEY",
  },
]

interface FrameworkPickerProps {
  selected: Framework
  onSelect: (fw: Framework & string) => void
}

export function FrameworkPicker({ selected, onSelect }: FrameworkPickerProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {FRAMEWORKS.map((fw) => (
        <button
          key={fw.id}
          type="button"
          onClick={() => onSelect(fw.id)}
          className={cn(
            "px-4 py-3 text-sm font-medium border border-dashed transition-colors text-left",
            selected === fw.id
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border text-muted hover:border-primary/50 hover:text-foreground",
          )}
        >
          {fw.name}
        </button>
      ))}
    </div>
  )
}
