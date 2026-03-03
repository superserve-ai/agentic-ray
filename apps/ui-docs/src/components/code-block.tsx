import { useEffect, useState } from "react"
import { type Highlighter, createHighlighter } from "shiki"
import { Button } from "@superserve/ui"
import { Check, Copy } from "lucide-react"

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark-default"],
      langs: ["tsx"],
    })
  }
  return highlighterPromise
}

const highlightCache = new Map<string, string>()

async function highlight(code: string): Promise<string> {
  const cached = highlightCache.get(code)
  if (cached) return cached

  const highlighter = await getHighlighter()
  const html = highlighter.codeToHtml(code, {
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
    let cancelled = false
    highlight(code).then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [code])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
  }

  return (
    <div className="relative group">
      <Button
        variant="link"
        size="icon-sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 text-neutral-200"
        onClick={handleCopy}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
      <div className="overflow-x-auto border border-border bg-[#0d1117] px-4 py-3 font-mono text-xs leading-relaxed [&_pre]:!bg-transparent [&_code]:!bg-transparent">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="text-neutral-400">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
