import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const selectMeta: ComponentMeta = {
  slug: "select",
  name: "Select",
  description: "A dropdown select menu with customizable options.",
  category: "Inputs",
  source: "components/select.tsx",
  props: [
    {
      name: "position",
      type: '"popper" | "item-aligned"',
      default: '"popper"',
      component: "SelectContent",
      description: "The positioning strategy.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: (
        <div className="max-w-sm">
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="option-1">Option One</SelectItem>
              <SelectItem value="option-2">Option Two</SelectItem>
              <SelectItem value="option-3">Option Three</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ),
      code: `<Select>
  <SelectTrigger>
    <SelectValue placeholder="Select an option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option-1">Option One</SelectItem>
    <SelectItem value="option-2">Option Two</SelectItem>
    <SelectItem value="option-3">Option Three</SelectItem>
  </SelectContent>
</Select>`,
    },
  ],
}
