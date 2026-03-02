import { Button, Popover, PopoverContent, PopoverTrigger } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

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
      description: "Horizontal alignment.",
    },
    {
      name: "sideOffset",
      type: "number",
      default: "4",
      description: "Distance from the trigger in pixels.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Open Popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Popover Title</p>
              <p className="text-sm text-muted">
                This is a popover with some descriptive content.
              </p>
            </div>
          </PopoverContent>
        </Popover>
      ),
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
