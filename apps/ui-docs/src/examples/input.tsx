import { Input, Kbd } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const inputMeta: ComponentMeta = {
  slug: "input",
  name: "Input",
  description: "A text input field with optional label, error, and description.",
  category: "Inputs",
  source: "components/input.tsx",
  props: [
    {
      name: "label",
      type: "string",
      description: "Label displayed above the input.",
    },
    {
      name: "error",
      type: "string",
      description: "Error message displayed below the input.",
    },
    {
      name: "description",
      type: "string",
      description: "Helper text displayed below the input.",
    },
    {
      name: "suffix",
      type: "ReactNode",
      description: "Element rendered inside the input on the right.",
    },
    {
      name: "wrapperClassName",
      type: "string",
      description: "Class name for the wrapper element.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: (
        <div className="max-w-sm space-y-4">
          <Input placeholder="Enter your name" />
        </div>
      ),
      code: `<Input placeholder="Enter your name" />`,
    },
    {
      title: "With Label",
      preview: (
        <div className="max-w-sm space-y-4">
          <Input label="Email" placeholder="you@example.com" />
        </div>
      ),
      code: `<Input label="Email" placeholder="you@example.com" />`,
    },
    {
      title: "With Description",
      preview: (
        <div className="max-w-sm space-y-4">
          <Input
            label="Username"
            placeholder="superserve"
            description="This will be your public display name."
          />
        </div>
      ),
      code: `<Input
  label="Username"
  placeholder="superserve"
  description="This will be your public display name."
/>`,
    },
    {
      title: "With Error",
      preview: (
        <div className="max-w-sm space-y-4">
          <Input
            label="Email"
            placeholder="you@example.com"
            error="Please enter a valid email address."
          />
        </div>
      ),
      code: `<Input
  label="Email"
  placeholder="you@example.com"
  error="Please enter a valid email address."
/>`,
    },
    {
      title: "With Suffix",
      preview: (
        <div className="max-w-sm space-y-4">
          <Input placeholder="Search..." suffix={<Kbd>/</Kbd>} />
        </div>
      ),
      code: `<Input placeholder="Search..." suffix={<Kbd>/</Kbd>} />`,
    },
    {
      title: "Disabled",
      preview: (
        <div className="max-w-sm space-y-4">
          <Input placeholder="Disabled input" disabled />
        </div>
      ),
      code: `<Input placeholder="Disabled input" disabled />`,
    },
  ],
}
