"use client"

import { Check, Copy } from "lucide-react"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"

interface CodeBlockProps {
  command: string
  eventName?: string
}

export function CodeBlock({ command, eventName }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const posthog = usePostHog()

  const copy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    if (posthog && eventName) {
      posthog.capture(eventName, { command })
    }
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center bg-[#09090b] border border-border px-4 py-3.5">
      <code className="flex-1 text-sm font-mono text-white/80 overflow-x-auto">
        <span className="text-white/70 mr-2 select-none">$</span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="ml-3 text-white/40 hover:text-white/80 transition-colors shrink-0"
      >
        {copied ? (
          <Check className="h-4 w-4 text-emerald-400" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    </div>
  )
}
