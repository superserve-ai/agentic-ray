import { useState } from "react"
import { Button, ConfirmDialog } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

function ConfirmDialogDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>Delete Item</Button>
      {open && (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete this item?"
          description="This action cannot be undone. The item will be permanently removed."
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => setOpen(false)}
        />
      )}
    </>
  )
}

export const confirmDialogMeta: ComponentMeta = {
  slug: "confirm-dialog",
  name: "ConfirmDialog",
  description: "A confirmation dialog for destructive actions.",
  category: "Overlays",
  source: "components/confirm-dialog.tsx",
  props: [
    {
      name: "open",
      type: "boolean",
      required: true,
      description: "Whether the dialog is open.",
    },
    {
      name: "onOpenChange",
      type: "(open: boolean) => void",
      required: true,
      description: "Callback when open state changes.",
    },
    {
      name: "title",
      type: "string",
      required: true,
      description: "The dialog title.",
    },
    {
      name: "description",
      type: "string",
      required: true,
      description: "The dialog description.",
    },
    {
      name: "confirmLabel",
      type: "string",
      default: '"Confirm"',
      description: "Label for the confirm button.",
    },
    {
      name: "cancelLabel",
      type: "string",
      default: '"Cancel"',
      description: "Label for the cancel button.",
    },
    {
      name: "variant",
      type: '"danger" | "warning"',
      default: '"danger"',
      description: "The visual style of the dialog.",
    },
    {
      name: "onConfirm",
      type: "() => void",
      required: true,
      description: "Callback when the confirm button is clicked.",
    },
    {
      name: "isLoading",
      type: "boolean",
      default: "false",
      description: "Whether the confirm action is loading.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: <ConfirmDialogDemo />,
      code: `<ConfirmDialog
  open={open}
  onOpenChange={setOpen}
  title="Delete this item?"
  description="This action cannot be undone. The item will be permanently removed."
  confirmLabel="Delete"
  variant="danger"
  onConfirm={() => setOpen(false)}
/>`,
    },
  ],
}
