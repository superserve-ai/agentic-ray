"use client"

import {
  CheckIcon,
  CopyIcon,
  KeyIcon,
  PlusIcon,
  LockKeyIcon,
} from "@phosphor-icons/react"
import { Button, cn, HighlightedCode, useToast } from "@superserve/ui"
import { motion } from "motion/react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { PageHeader } from "@/components/page-header"
import { useCreateApiKey } from "@/hooks/use-api-keys"

type Language = "typescript" | "python"

const INSTALL_COMMANDS: Record<Language, string> = {
  typescript: "npm install @superserve/sdk",
  python: "pip install superserve",
}

function getSnippet(language: Language, apiKey: string): string {
  const key = apiKey || "ss_live_xxxxxxxx..."

  if (language === "typescript") {
    return `import { Sandbox } from "@superserve/sdk"

const sandbox = await Sandbox.create({
  name: "my-sandbox",
  apiKey: "${key}",
})

const result = await sandbox.commands.run("echo 'Hello from Superserve!'")
console.log(result.stdout)

await sandbox.files.write("/tmp/hello.txt", "Hello, world!")
const content = await sandbox.files.readText("/tmp/hello.txt")
console.log(content)

await sandbox.kill()`
  }

  return `from superserve import Sandbox

sandbox = Sandbox.create(
    name="my-sandbox",
    api_key="${key}",
)

result = sandbox.commands.run("echo 'Hello from Superserve!'")
print(result.stdout)

sandbox.files.write("/tmp/hello.txt", "Hello, world!")
content = sandbox.files.read_text("/tmp/hello.txt")
print(content)

sandbox.kill()`
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

function StepHeader({
  stepNumber,
  title,
  completed,
}: {
  stepNumber: number
  title: string
  completed?: boolean
}) {
  return (
    <div className="relative flex items-center gap-2.5 bg-surface-hover px-3.5 py-4">
      <CornerBrackets size="md" />
      <span className="font-mono text-sm leading-none tracking-tight text-muted">
        {String(stepNumber).padStart(2, "0")}.
      </span>
      <span className="flex-1 text-sm leading-none tracking-tight text-foreground">
        {title}
      </span>
      {completed && (
        <CheckIcon className="size-4 text-success" weight="light" />
      )}
    </div>
  )
}

function CodeBlock({
  code,
  lang,
}: {
  code: string
  lang: "typescript" | "python" | "bash"
}) {
  return (
    <div className="flex items-start border border-dashed border-border bg-background px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <HighlightedCode code={code} lang={lang} />
      </div>
      <CopyButton text={code} />
    </div>
  )
}

const LANGUAGES: { label: string; value: Language }[] = [
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
]

export default function GetStartedPage() {
  const router = useRouter()
  const [language, setLanguage] = useState<Language>("typescript")
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const createKeyMutation = useCreateApiKey()
  const createdKey = createKeyMutation.data
    ? {
        full: createKeyMutation.data.key,
        prefix: createKeyMutation.data.prefix,
      }
    : null
  const [copied, setCopied] = useState(false)
  const { addToast } = useToast()

  const handleCreateKey = () => {
    createKeyMutation.mutate("Get Started Key")
  }

  const handleCopyKey = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.full)
    setCopied(true)
    addToast("API key copied to clipboard", "success")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Get Started" />

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between">
            <p className="text-sm leading-none tracking-tight text-muted">
              Install the SDK and create your first sandbox
            </p>

            {/* Language Toggle */}
            <div
              className="flex items-center gap-1 py-2"
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
                        layoutId="get-started-lang-hover"
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
                        layoutId="get-started-lang-active"
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
          </div>

          <div className="mt-10 space-y-10">
            {/* Step 1: Install SDK */}
            <div className="space-y-4">
              <StepHeader stepNumber={1} title="Install the SDK" />
              <p className="pl-6 text-sm leading-none tracking-tight text-muted">
                Add the Superserve SDK to your project
              </p>
              <div className="pl-6">
                <CodeBlock code={INSTALL_COMMANDS[language]} lang="bash" />
              </div>
            </div>

            {/* Step 2: Create API Key */}
            <div className="space-y-4">
              <StepHeader
                stepNumber={2}
                title="Create an API Key"
                completed={!!createdKey}
              />
              <p className="pl-6 text-sm leading-none tracking-tight text-muted">
                Generate an API key to authenticate with the SDK
              </p>
              <div className="pl-6">
                {createdKey ? (
                  <div className="flex items-center gap-2 border border-border bg-background px-4 py-3.5">
                    <KeyIcon
                      className="size-4 shrink-0 text-muted"
                      weight="light"
                    />
                    <code className="flex-1 font-mono text-sm break-all text-foreground/80">
                      {createdKey.full}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      aria-label={copied ? "Copied" : "Copy API key"}
                      className="shrink-0 cursor-pointer text-muted transition-colors hover:text-foreground"
                    >
                      {copied ? (
                        <CheckIcon
                          className="size-4 text-success"
                          weight="light"
                        />
                      ) : (
                        <CopyIcon className="size-4" weight="light" />
                      )}
                    </button>
                  </div>
                ) : (
                  <Button
                    onClick={handleCreateKey}
                    size="sm"
                    disabled={createKeyMutation.isPending}
                  >
                    <PlusIcon className="size-3.5" weight="light" />
                    {createKeyMutation.isPending ? "Creating..." : "Create Key"}
                  </Button>
                )}
              </div>
            </div>

            {/* Step 3: Create & Run Sandbox */}
            <div className="space-y-4">
              <StepHeader stepNumber={3} title="Create your first sandbox" />
              <p className="pl-6 text-sm leading-none tracking-tight text-muted">
                Use the SDK to spin up and tear down a sandbox
              </p>
              <div className="pl-6">
                <CodeBlock
                  code={getSnippet(language, createdKey?.full ?? "")}
                  lang={language}
                />
              </div>
            </div>

            {/* Step 4: Store a credential */}
            <div className="space-y-4">
              <StepHeader stepNumber={4} title="Store a credential" />
              <p className="pl-6 text-sm leading-relaxed tracking-tight text-muted">
                Let sandboxed code use API keys it can never read - the real
                value never enters the sandbox. Store a credential once, then
                attach it to sandboxes as a secret.
              </p>
              <div className="pl-6">
                <Button
                  size="sm"
                  onClick={() => router.push("/secrets?create=1")}
                >
                  <LockKeyIcon className="size-3.5" weight="light" />
                  Add secret
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
