import { useEffect, useState } from "react"
import { codeToHtml } from "shiki"
import { Button } from "@superserve/ui"
import { Check, Copy } from "lucide-react"

const highlightCache = new Map<string, string>()

async function highlight(code: string): Promise<string> {
  const cached = highlightCache.get(code)
  if (cached) return cached

  const html = await codeToHtml(code, {
    lang: "tsx",
    theme: "github-dark-default",
  })
  highlightCache.set(code, html)
  return html
}

export function CodeBlock({ code }: { code: string }) {
  const [html, setHtml] = useState<string>("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    highlight(code).then(setHtml)
  }, [code])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group">
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
      <div
        className="overflow-x-auto border border-border bg-[#0d1117] px-4 py-3 font-mono text-xs leading-relaxed [&_pre]:!bg-transparent [&_code]:!bg-transparent"
        dangerouslySetInnerHTML={html ? { __html: html } : undefined}
      />
    </div>
  )
}
