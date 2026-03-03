import { Avatar } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const avatarMeta: ComponentMeta = {
  slug: "avatar",
  name: "Avatar",
  description: "A circular avatar with image or fallback text.",
  category: "Data Display",
  source: "components/avatar.tsx",
  props: [
    {
      name: "src",
      type: "string",
      description: "Image URL.",
    },
    {
      name: "alt",
      type: "string",
      description: "Alt text for the image.",
    },
    {
      name: "fallback",
      type: "string",
      required: true,
      description: "Fallback text when no image.",
    },
    {
      name: "size",
      type: '"xs" | "sm" | "default" | "lg"',
      default: '"default"',
      description: "The size of the avatar.",
    },
  ],
  examples: [
    {
      title: "Sizes",
      preview: (
        <div className="flex items-center gap-3">
          <Avatar size="xs" fallback="XS" />
          <Avatar size="sm" fallback="SM" />
          <Avatar size="default" fallback="DF" />
          <Avatar size="lg" fallback="LG" />
        </div>
      ),
      code: `<Avatar size="xs" fallback="XS" />
<Avatar size="sm" fallback="SM" />
<Avatar size="default" fallback="DF" />
<Avatar size="lg" fallback="LG" />`,
    },
  ],
}
