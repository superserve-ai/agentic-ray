import { Progress } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const progressMeta: ComponentMeta = {
  slug: "progress",
  name: "Progress",
  description: "A horizontal progress bar.",
  category: "Feedback",
  source: "components/progress.tsx",
  props: [
    {
      name: "value",
      type: "number",
      required: true,
      description: "Current progress value.",
    },
    {
      name: "max",
      type: "number",
      default: "100",
      description: "Maximum value.",
    },
    {
      name: "variant",
      type: '"default" | "success" | "warning" | "destructive"',
      default: '"default"',
      description: "The color variant.",
    },
  ],
  examples: [
    {
      title: "Default (60%)",
      preview: (
        <div className="max-w-md w-full">
          <Progress value={60} />
        </div>
      ),
      code: `<Progress value={60} />`,
    },
    {
      title: "Success (80%)",
      preview: (
        <div className="max-w-md w-full">
          <Progress value={80} variant="success" />
        </div>
      ),
      code: `<Progress value={80} variant="success" />`,
    },
    {
      title: "Warning (45%)",
      preview: (
        <div className="max-w-md w-full">
          <Progress value={45} variant="warning" />
        </div>
      ),
      code: `<Progress value={45} variant="warning" />`,
    },
    {
      title: "Destructive (90%)",
      preview: (
        <div className="max-w-md w-full">
          <Progress value={90} variant="destructive" />
        </div>
      ),
      code: `<Progress value={90} variant="destructive" />`,
    },
  ],
}
