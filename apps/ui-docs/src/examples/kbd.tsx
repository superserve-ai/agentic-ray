import { Kbd } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const kbdMeta: ComponentMeta = {
  slug: "kbd",
  name: "Kbd",
  description: "A keyboard key indicator.",
  category: "Data Display",
  source: "components/kbd.tsx",
  props: [],
  examples: [
    {
      title: "Keyboard Shortcuts",
      preview: (
        <div className="flex flex-wrap items-center gap-3">
          <Kbd>{"\u2318"}</Kbd>
          <span className="flex items-center gap-1">
            <Kbd>{"\u2318"}</Kbd>
            <Kbd>K</Kbd>
          </span>
          <Kbd>Ctrl</Kbd>
          <span className="flex items-center gap-1">
            <Kbd>Shift</Kbd>
            <Kbd>Enter</Kbd>
          </span>
        </div>
      ),
      code: `<Kbd>\u2318</Kbd>
<Kbd>\u2318</Kbd> <Kbd>K</Kbd>
<Kbd>Ctrl</Kbd>
<Kbd>Shift</Kbd> <Kbd>Enter</Kbd>`,
    },
  ],
}
