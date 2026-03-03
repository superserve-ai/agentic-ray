import { buttonMeta } from "../examples/button"
import { inputMeta } from "../examples/input"
import { textareaMeta } from "../examples/textarea"
import { checkboxMeta } from "../examples/checkbox"
import { radioGroupMeta } from "../examples/radio-group"
import { switchMeta } from "../examples/switch"
import { selectMeta } from "../examples/select"
import { formFieldMeta } from "../examples/form-field"
import { badgeMeta } from "../examples/badge"
import { alertMeta } from "../examples/alert"
import { progressMeta } from "../examples/progress"
import { toastMeta } from "../examples/toast"
import { tooltipMeta } from "../examples/tooltip"
import { avatarMeta } from "../examples/avatar"
import { cardMeta } from "../examples/card"
import { tableMeta } from "../examples/table"
import { tabsMeta } from "../examples/tabs"
import { accordionMeta } from "../examples/accordion"
import { breadcrumbsMeta } from "../examples/breadcrumbs"
import { kbdMeta } from "../examples/kbd"
import { skeletonMeta } from "../examples/skeleton"
import { dialogMeta } from "../examples/dialog"
import { confirmDialogMeta } from "../examples/confirm-dialog"
import { dropdownMenuMeta } from "../examples/dropdown-menu"
import { popoverMeta } from "../examples/popover"
import { separatorMeta } from "../examples/separator"
import type { Category, ComponentMeta } from "./types"

export const registry: ComponentMeta[] = [
  buttonMeta,
  inputMeta,
  textareaMeta,
  checkboxMeta,
  radioGroupMeta,
  switchMeta,
  selectMeta,
  formFieldMeta,
  badgeMeta,
  alertMeta,
  progressMeta,
  toastMeta,
  tooltipMeta,
  avatarMeta,
  cardMeta,
  tableMeta,
  tabsMeta,
  accordionMeta,
  breadcrumbsMeta,
  kbdMeta,
  skeletonMeta,
  dialogMeta,
  confirmDialogMeta,
  dropdownMenuMeta,
  popoverMeta,
  separatorMeta,
]

export const categories: Category[] = [
  "Inputs",
  "Feedback",
  "Data Display",
  "Overlays",
  "Layout",
]

export function getByCategory(category: Category): ComponentMeta[] {
  return registry.filter((c) => c.category === category)
}

export function getBySlug(slug: string): ComponentMeta | undefined {
  return registry.find((c) => c.slug === slug)
}
