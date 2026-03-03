import { Textarea } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const textareaMeta: ComponentMeta = {
  slug: "textarea",
  name: "Textarea",
  description: "A multi-line text input.",
  category: "Inputs",
  source: "components/textarea.tsx",
  props: [
    {
      name: "label",
      type: "string",
      description: "Label displayed above the textarea.",
    },
    {
      name: "error",
      type: "string",
      description: "Error message displayed below the textarea.",
    },
    {
      name: "description",
      type: "string",
      description: "Helper text displayed below the textarea.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: (
        <div className="max-w-sm space-y-4">
          <Textarea placeholder="Type your message here" />
        </div>
      ),
      code: `<Textarea placeholder="Type your message here" />`,
    },
    {
      title: "With Label",
      preview: (
        <div className="max-w-sm space-y-4">
          <Textarea label="Message" placeholder="Type your message here" />
        </div>
      ),
      code: `<Textarea label="Message" placeholder="Type your message here" />`,
    },
    {
      title: "With Error",
      preview: (
        <div className="max-w-sm space-y-4">
          <Textarea
            label="Bio"
            placeholder="Tell us about yourself"
            error="Bio must be at least 10 characters."
          />
        </div>
      ),
      code: `<Textarea
  label="Bio"
  placeholder="Tell us about yourself"
  error="Bio must be at least 10 characters."
/>`,
    },
    {
      title: "Disabled",
      preview: (
        <div className="max-w-sm space-y-4">
          <Textarea placeholder="Disabled textarea" disabled />
        </div>
      ),
      code: `<Textarea placeholder="Disabled textarea" disabled />`,
    },
  ],
}
