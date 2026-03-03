import { useState } from "react"
import { Button } from "@superserve/ui"
import { Code, X } from "lucide-react"
import type { ComponentExample } from "../registry/types"
import { CodeBlock } from "./code-block"

export function ExamplePreview({ example }: { example: ComponentExample }) {
  const [showCode, setShowCode] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-mono text-muted">{example.title}</p>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setShowCode(!showCode)}
        >
          {showCode ? <X className="size-3.5" /> : <Code className="size-3.5" />}
        </Button>
      </div>
      <div className="border border-dashed border-border p-6">
        {example.preview}
      </div>
      {showCode && (
        <div className="mt-0">
          <CodeBlock code={example.code} />
        </div>
      )}
    </div>
  )
}
