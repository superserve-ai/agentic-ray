import { Separator } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const separatorMeta: ComponentMeta = {
  slug: "separator",
  name: "Separator",
  description: "A visual divider between content sections.",
  category: "Layout",
  source: "components/separator.tsx",
  props: [
    {
      name: "orientation",
      type: '"horizontal" | "vertical"',
      default: '"horizontal"',
      description: "The direction of the separator.",
    },
  ],
  examples: [
    {
      title: "Horizontal",
      preview: (
        <div className="max-w-sm space-y-0">
          <p className="text-sm text-foreground py-2">Content above</p>
          <Separator />
          <p className="text-sm text-foreground py-2">Content below</p>
        </div>
      ),
      code: `<p>Content above</p>
<Separator />
<p>Content below</p>`,
    },
    {
      title: "Vertical",
      preview: (
        <div className="flex items-center gap-3">
          <span className="text-sm text-foreground">Left</span>
          <Separator orientation="vertical" className="h-6" />
          <span className="text-sm text-foreground">Right</span>
        </div>
      ),
      code: `<div className="flex items-center gap-3">
  <span>Left</span>
  <Separator orientation="vertical" className="h-6" />
  <span>Right</span>
</div>`,
    },
  ],
}
