// Type declarations for template.mjs.
import type { BuildLogEvent, Template } from "@superserve/sdk"

export const TEMPLATE_NAME: string

export const TEMPLATE_SPEC: {
  from: string
  vcpu: number
  memoryMib: number
  diskMib: number
  steps: Array<{ run: string } | { workdir: string }>
}

export function ensureTemplate(opts?: {
  name?: string
  onLog?: (event: BuildLogEvent) => void
  log?: (message: string) => void
}): Promise<Template>
