import { Breadcrumbs } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const breadcrumbsMeta: ComponentMeta = {
  slug: "breadcrumbs",
  name: "Breadcrumbs",
  description: "Navigation breadcrumb trail.",
  category: "Data Display",
  source: "components/breadcrumbs.tsx",
  props: [
    {
      name: "items",
      type: "BreadcrumbItem[]",
      required: true,
      description: "Array of breadcrumb items with label and optional href.",
    },
    {
      name: "renderLink",
      type: "function",
      description: "Custom link renderer.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: (
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Projects", href: "/projects" },
            { label: "Current Page" },
          ]}
        />
      ),
      code: `<Breadcrumbs
  items={[
    { label: "Home", href: "/" },
    { label: "Projects", href: "/projects" },
    { label: "Current Page" },
  ]}
/>`,
    },
  ],
}
