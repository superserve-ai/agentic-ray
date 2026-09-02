"use client"

import {
  CheckIcon,
  CopyIcon,
  KeyIcon,
  PlusIcon,
  TerminalIcon,
} from "@phosphor-icons/react"
import {
  Alert,
  Button,
  cn,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  HighlightedCode,
} from "@superserve/ui"
import { motion } from "motion/react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { useApiKeys, useCreateApiKey } from "@/hooks/use-api-keys"

export type Language = "typescript" | "python"

export const LANGUAGES: { label: string; value: Language; icon: string }[] = [
  { label: "TypeScript", value: "typescript", icon: "TS" },
  { label: "Python", value: "python", icon: "PY" },
]

export const INSTALL_COMMANDS: Record<Language, string> = {
  typescript: "npm install @superserve/sdk",
  python: "pip install superserve",
}

export function getConnectSnippet(
  language: Language,
  apiKey: string,
  sandboxId: string,
): string {
  const key = apiKey || "ss_live_xxxxxxxx..."

  if (language === "typescript") {
    return `import { Sandbox } from "@superserve/sdk"

const sandbox = await Sandbox.connect("${sandboxId}", {
  apiKey: "${key}",
})

const result = await sandbox.commands.run("echo 'Hello from Superserve!'")
console.log(result.stdout)`
  }

  return `from superserve import Sandbox

sandbox = Sandbox.connect(
    "${sandboxId}",
    api_key="${key}",
)

result = sandbox.commands.run("echo 'Hello from Superserve!'")
print(result.stdout)`
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : (label ?? "Copy")}
      className="shrink-0 cursor-pointer text-muted transition-colors hover:text-foreground"
    >
      {copied ? (
        <CheckIcon className="size-4 text-success" weight="light" />
      ) : (
        <CopyIcon className="size-4" weight="light" />
      )}
    </button>
  )
}

interface ConnectSandboxDialogProps {
  sandboxId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConnectSandboxDialog({
  sandboxId,
  open,
  onOpenChange,
}: ConnectSandboxDialogProps) {
  const router = useRouter()
  const [language, setLanguage] = useState<Language>("typescript")
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const createKeyMutation = useCreateApiKey()
  const { data: existingKeys } = useApiKeys()
  const [copiedKey, setCopiedKey] = useState(false)

  // Check if user has a non-dashboard API key
  const userKey = existingKeys?.find((k) => !k.name.startsWith("__console_"))
  const newlyCreatedKey = createKeyMutation.data?.key ?? ""
  const snippetKey = newlyCreatedKey || (userKey ? "YOUR_API_KEY" : "")
  const hasKey = !!userKey || !!newlyCreatedKey

  const handleCreateKey = () => {
    createKeyMutation.mutate("SDK Key")
  }

  const handleCopyKey = async () => {
    if (!newlyCreatedKey) return
    await navigator.clipboard.writeText(newlyCreatedKey)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect to Sandbox</DialogTitle>
        </DialogHeader>

        {/* Language Tabs */}
        <div
          className="mx-6 flex items-center gap-1 border-b border-dashed border-border py-2"
          onMouseLeave={() => setHoveredTab(null)}
        >
          {LANGUAGES.map((lang) => {
            const isActive = language === lang.value
            const isHovered = hoveredTab === lang.value

            return (
              <button
                key={lang.value}
                type="button"
                onClick={() => setLanguage(lang.value)}
                onMouseEnter={() => setHoveredTab(lang.value)}
                className={cn(
                  "relative inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 font-mono text-xs transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {isHovered && (
                  <motion.span
                    className="absolute inset-0 bg-brand/10"
                    layoutId="connect-lang-hover"
                    transition={{
                      type: "spring",
                      bounce: 0.15,
                      duration: 0.4,
                    }}
                  />
                )}
                {isActive && !hoveredTab && (
                  <span className="absolute inset-0 bg-brand/10" />
                )}
                {isActive && (
                  <motion.span
                    className="pointer-events-none absolute inset-0"
                    layoutId="connect-lang-active"
                    transition={{
                      type: "spring",
                      bounce: 0.15,
                      duration: 0.5,
                    }}
                  >
                    <CornerBrackets size="sm" />
                  </motion.span>
                )}
                <span className="relative">{lang.label}</span>
              </button>
            )
          })}
        </div>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6">
          {/* API Key */}
          {!hasKey && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-foreground">
                API Key
              </span>
              <p className="text-xs text-muted">
                Create an API key to authenticate with the SDK
              </p>
              <Button
                onClick={handleCreateKey}
                variant="outline"
                size="sm"
                disabled={createKeyMutation.isPending}
              >
                <PlusIcon className="size-3.5" weight="light" />
                {createKeyMutation.isPending ? "Creating..." : "Create API Key"}
              </Button>
            </div>
          )}

          {newlyCreatedKey && (
            <div className="space-y-3">
              <span className="block text-sm font-medium text-foreground">
                API Key
              </span>
              <div className="flex items-center gap-2 border border-border bg-background px-4 py-3">
                <KeyIcon
                  className="size-4 shrink-0 text-muted"
                  weight="light"
                />
                <code className="flex-1 font-mono text-sm break-all text-foreground/80">
                  {newlyCreatedKey}
                </code>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  aria-label={copiedKey ? "Copied" : "Copy API key"}
                  className="shrink-0 cursor-pointer text-muted transition-colors hover:text-foreground"
                >
                  {copiedKey ? (
                    <CheckIcon className="size-4 text-success" weight="light" />
                  ) : (
                    <CopyIcon className="size-4" weight="light" />
                  )}
                </button>
              </div>
              <Alert variant="warning">
                Make sure to copy your API key — it won&apos;t be shown again.
              </Alert>
            </div>
          )}

          {/* Install SDK */}
          <div className="space-y-2">
            <span className="block text-sm font-medium text-foreground">
              Install SDK
            </span>
            <div className="flex items-start border border-dashed border-border bg-background px-4 py-3">
              <div className="min-w-0 flex-1">
                <HighlightedCode
                  code={INSTALL_COMMANDS[language]}
                  lang="bash"
                />
              </div>
              <CopyButton text={INSTALL_COMMANDS[language]} />
            </div>
          </div>

          {/* Connect & Run */}
          <div className="space-y-2">
            <span className="block text-sm font-medium text-foreground">
              Connect and Run
            </span>
            <div className="flex max-h-[180px] items-start overflow-y-auto border border-dashed border-border bg-background px-4 py-3">
              <div className="min-w-0 flex-1">
                <HighlightedCode
                  code={getConnectSnippet(language, snippetKey, sandboxId)}
                  lang={language}
                />
              </div>
              <CopyButton
                text={getConnectSnippet(language, snippetKey, sandboxId)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => router.push(`/sandboxes/${sandboxId}/terminal/`)}
          >
            <TerminalIcon className="size-3.5" weight="light" />
            Open Terminal
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
