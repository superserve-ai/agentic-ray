import { Button } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const buttonMeta: ComponentMeta = {
  slug: "button",
  name: "Button",
  description: "A clickable button with multiple variants and sizes.",
  category: "Inputs",
  source: "components/button.tsx",
  props: [
    {
      name: "variant",
      type: '"default" | "destructive" | "outline" | "ghost" | "link"',
      default: '"default"',
      description: "The visual style of the button.",
    },
    {
      name: "size",
      type: '"default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg"',
      default: '"default"',
      description: "The size of the button.",
    },
    {
      name: "asChild",
      type: "boolean",
      default: "false",
      description: "Render as a child element using Radix Slot.",
    },
  ],
  examples: [
    {
      title: "Variants",
      preview: (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="default">Default</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
        </div>
      ),
      code: `<Button variant="default">Default</Button>
<Button variant="destructive">Destructive</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>`,
    },
    {
      title: "Sizes",
      preview: (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
        </div>
      ),
      code: `<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>`,
    },
    {
      title: "Disabled",
      preview: (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>
            Disabled Outline
          </Button>
        </div>
      ),
      code: `<Button disabled>Disabled</Button>
<Button variant="outline" disabled>Disabled Outline</Button>`,
    },
  ],
}
