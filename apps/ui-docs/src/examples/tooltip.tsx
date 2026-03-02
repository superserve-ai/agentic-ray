import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const tooltipMeta: ComponentMeta = {
  slug: "tooltip",
  name: "Tooltip",
  description: "A popup that displays information on hover.",
  category: "Feedback",
  source: "components/tooltip.tsx",
  props: [
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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover Me</Button>
            </TooltipTrigger>
            <TooltipContent>This is a tooltip</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      code: `<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="outline">Hover Me</Button>
    </TooltipTrigger>
    <TooltipContent>This is a tooltip</TooltipContent>
  </Tooltip>
</TooltipProvider>`,
    },
  ],
}
