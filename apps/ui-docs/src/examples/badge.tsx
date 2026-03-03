import { Badge } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const badgeMeta: ComponentMeta = {
  slug: "badge",
  name: "Badge",
  description: "A small label for status or metadata.",
  category: "Feedback",
  source: "components/badge.tsx",
  props: [
    {
      name: "variant",
      type: '"default" | "success" | "warning" | "destructive" | "muted"',
      default: '"default"',
      description: "The visual style.",
    },
    {
      name: "dot",
      type: "boolean",
      default: "false",
      description: "Show a colored dot indicator.",
    },
  ],
  examples: [
    {
      title: "Variants",
      preview: (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">Default</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="muted">Muted</Badge>
        </div>
      ),
      code: `<Badge variant="default">Default</Badge>
<Badge variant="success">Success</Badge>
<Badge variant="warning">Warning</Badge>
<Badge variant="destructive">Destructive</Badge>
<Badge variant="muted">Muted</Badge>`,
    },
    {
      title: "With Dot",
      preview: (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default" dot>Default</Badge>
          <Badge variant="success" dot>Success</Badge>
          <Badge variant="warning" dot>Warning</Badge>
          <Badge variant="destructive" dot>Destructive</Badge>
          <Badge variant="muted" dot>Muted</Badge>
        </div>
      ),
      code: `<Badge variant="default" dot>Default</Badge>
<Badge variant="success" dot>Success</Badge>
<Badge variant="warning" dot>Warning</Badge>
<Badge variant="destructive" dot>Destructive</Badge>
<Badge variant="muted" dot>Muted</Badge>`,
    },
  ],
}
