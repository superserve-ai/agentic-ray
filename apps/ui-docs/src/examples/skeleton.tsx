import { Skeleton } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const skeletonMeta: ComponentMeta = {
  slug: "skeleton",
  name: "Skeleton",
  description: "A placeholder loading animation.",
  category: "Data Display",
  source: "components/skeleton.tsx",
  props: [],
  examples: [
    {
      title: "Default",
      preview: (
        <div className="space-y-3 max-w-sm">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </div>
      ),
      code: `<Skeleton className="h-4 w-3/4" />
<Skeleton className="h-4 w-1/2" />
<Skeleton className="h-20 w-full" />`,
    },
  ],
}
