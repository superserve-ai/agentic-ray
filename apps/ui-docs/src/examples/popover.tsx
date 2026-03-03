import { useState } from "react"
import { Button, Popover, PopoverContent, PopoverTrigger } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

function PopoverDemo() {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">Open Popover</Button>
      </PopoverTrigger>
      {open && (
        <PopoverContent>
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Popover Title</p>
            <p className="text-sm text-muted">
              This is a popover with some descriptive content.
            </p>
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}

export const popoverMeta: ComponentMeta = {
  slug: "popover",
  name: "Popover",
  description: "A floating panel anchored to a trigger.",
  category: "Overlays",
  source: "components/popover.tsx",
  props: [
    {
      name: "align",
      type: '"start" | "center" | "end"',
      default: '"center"',
      component: "PopoverContent",
      description: "Horizontal alignment.",
    },
    {
      name: "sideOffset",
      type: "number",
      default: "4",
      component: "PopoverContent",
      description: "Distance from the trigger in pixels.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: <PopoverDemo />,
      code: `<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Open Popover</Button>
  </PopoverTrigger>
  <PopoverContent>
    <p className="text-sm font-medium">Popover Title</p>
    <p className="text-sm text-muted">
      This is a popover with some descriptive content.
    </p>
  </PopoverContent>
</Popover>`,
    },
  ],
}
