import { Checkbox } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const checkboxMeta: ComponentMeta = {
  slug: "checkbox",
  name: "Checkbox",
  description: "A toggleable checkbox with optional label.",
  category: "Inputs",
  source: "components/checkbox.tsx",
  props: [
    {
      name: "label",
      type: "string",
      description: "Label displayed next to the checkbox.",
    },
  ],
  examples: [
    {
      title: "Variants",
      preview: (
        <div className="space-y-3">
          <Checkbox id="terms" label="Accept terms and conditions" />
          <Checkbox
            id="newsletter"
            label="Subscribe to newsletter"
            defaultChecked
          />
          <Checkbox id="disabled" label="Disabled checkbox" disabled />
        </div>
      ),
      code: `<Checkbox id="terms" label="Accept terms and conditions" />
<Checkbox id="newsletter" label="Subscribe to newsletter" defaultChecked />
<Checkbox id="disabled" label="Disabled checkbox" disabled />`,
    },
  ],
}
