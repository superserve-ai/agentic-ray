import type { ReactNode } from "react"

export type PropDef = {
  name: string
  type: string
  default?: string
  required?: boolean
  description: string
  /** For compound components, indicates which sub-component this prop belongs to. */
  component?: string
}

export type ComponentExample = {
  title: string
  preview: ReactNode
  code: string
}

export type Category = "Inputs" | "Feedback" | "Data Display" | "Overlays" | "Layout"

export type ComponentMeta = {
  slug: string
  name: string
  description: string
  category: Category
  source: string
  props: PropDef[]
  examples: ComponentExample[]
}
