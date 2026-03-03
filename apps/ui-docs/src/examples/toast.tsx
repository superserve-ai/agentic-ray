import { Button, useToast } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

function ToastDemo() {
  const { addToast } = useToast()
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={() => addToast("Info toast", "info")}>Info</Button>
      <Button variant="outline" onClick={() => addToast("Success toast", "success")}>Success</Button>
      <Button variant="outline" onClick={() => addToast("Warning toast", "warning")}>Warning</Button>
      <Button variant="outline" onClick={() => addToast("Error toast", "error")}>Error</Button>
      <Button variant="outline" onClick={() => addToast({ title: "With description", description: "This toast has a description and an action.", variant: "info", actions: [{ label: "Undo", onClick: () => {} }] })}>With Action</Button>
    </div>
  )
}

export const toastMeta: ComponentMeta = {
  slug: "toast",
  name: "Toast",
  description: "Temporary notification messages.",
  category: "Feedback",
  source: "components/toast.tsx",
  props: [
    {
      name: "title",
      type: "string",
      required: true,
      description: "The toast message or title.",
    },
    {
      name: "description",
      type: "string",
      description: "Secondary text below the title.",
    },
    {
      name: "variant",
      type: '"success" | "info" | "warning" | "error"',
      default: '"info"',
      description: "The visual style.",
    },
    {
      name: "actions",
      type: "ToastAction[]",
      description: "Action buttons on the toast.",
    },
  ],
  examples: [
    {
      title: "Toast Variants",
      preview: <ToastDemo />,
      code: `const { addToast } = useToast()

addToast("Info toast", "info")
addToast("Success toast", "success")
addToast({ title: "With description", description: "...", variant: "info", actions: [{ label: "Undo", onClick: () => {} }] })`,
    },
  ],
}
