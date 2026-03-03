import { RadioGroup, RadioGroupItem } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const radioGroupMeta: ComponentMeta = {
  slug: "radio-group",
  name: "Radio Group",
  description: "A set of mutually exclusive radio options.",
  category: "Inputs",
  source: "components/radio-group.tsx",
  props: [
    {
      name: "label",
      type: "string",
      component: "RadioGroupItem",
      description: "Label displayed next to the radio item.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: (
        <RadioGroup defaultValue="option-1">
          <RadioGroupItem value="option-1" id="option-1" label="Option One" />
          <RadioGroupItem value="option-2" id="option-2" label="Option Two" />
          <RadioGroupItem
            value="option-3"
            id="option-3"
            label="Option Three"
          />
        </RadioGroup>
      ),
      code: `<RadioGroup defaultValue="option-1">
  <RadioGroupItem value="option-1" id="option-1" label="Option One" />
  <RadioGroupItem value="option-2" id="option-2" label="Option Two" />
  <RadioGroupItem value="option-3" id="option-3" label="Option Three" />
</RadioGroup>`,
    },
  ],
}
