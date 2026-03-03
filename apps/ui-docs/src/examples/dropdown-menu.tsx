import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const dropdownMenuMeta: ComponentMeta = {
  slug: "dropdown-menu",
  name: "DropdownMenu",
  description: "A menu triggered by a button click.",
  category: "Overlays",
  source: "components/dropdown-menu.tsx",
  props: [
    {
      name: "sideOffset",
      type: "number",
      default: "4",
      component: "DropdownMenuContent",
      description: "Distance from the trigger in pixels.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Open Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      code: `<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline">Open Menu</Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem>Edit</DropdownMenuItem>
    <DropdownMenuItem>Duplicate</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem>Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>`,
    },
  ],
}
