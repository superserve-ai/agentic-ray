import { Alert } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const alertMeta: ComponentMeta = {
  slug: "alert",
  name: "Alert",
  description: "A contextual message for user feedback.",
  category: "Feedback",
  source: "components/alert.tsx",
  props: [
    {
      name: "variant",
      type: '"default" | "success" | "warning" | "destructive"',
      default: '"default"',
      description: "The visual style.",
    },
    {
      name: "title",
      type: "string",
      description: "Bold title at the top of the alert.",
    },
  ],
  examples: [
    {
      title: "Variants",
      preview: (
        <div className="space-y-3 max-w-lg">
          <Alert variant="default" title="Information">
            This is a default informational alert.
          </Alert>
          <Alert variant="success" title="Success">
            Your changes have been saved successfully.
          </Alert>
          <Alert variant="warning" title="Warning">
            Please review your input before continuing.
          </Alert>
          <Alert variant="destructive" title="Error">
            Something went wrong. Please try again.
          </Alert>
        </div>
      ),
      code: `<Alert variant="default" title="Information">
  This is a default informational alert.
</Alert>
<Alert variant="success" title="Success">
  Your changes have been saved successfully.
</Alert>
<Alert variant="warning" title="Warning">
  Please review your input before continuing.
</Alert>
<Alert variant="destructive" title="Error">
  Something went wrong. Please try again.
</Alert>`,
    },
    {
      title: "Without Title",
      preview: (
        <div className="space-y-3 max-w-lg">
          <Alert variant="default">
            This is an alert without a title.
          </Alert>
        </div>
      ),
      code: `<Alert variant="default">
  This is an alert without a title.
</Alert>`,
    },
  ],
}
