import { Switch } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const switchMeta: ComponentMeta = {
  slug: "switch",
  name: "Switch",
  description: "A toggle switch for boolean values.",
  category: "Inputs",
  source: "components/switch.tsx",
  props: [
    {
      name: "label",
      type: "string",
      description: "Label displayed next to the switch.",
    },
  ],
  examples: [
    {
      title: "Variants",
      preview: (
        <div className="space-y-3">
          <Switch id="notifications" label="Enable notifications" />
          <Switch id="dark-mode" label="Dark mode" defaultChecked />
          <Switch id="disabled" label="Disabled switch" disabled />
        </div>
      ),
      code: `<Switch id="notifications" label="Enable notifications" />
<Switch id="dark-mode" label="Dark mode" defaultChecked />
<Switch id="disabled" label="Disabled switch" disabled />`,
    },
  ],
}
