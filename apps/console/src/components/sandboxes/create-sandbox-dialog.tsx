"use client"

import {
  CaretDownIcon,
  CheckIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Button,
  cn,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Field,
  HighlightedCode,
  Input,
  useToast,
} from "@superserve/ui"
import { AnimatePresence, LayoutGroup, motion } from "motion/react"
import { usePostHog } from "posthog-js/react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { CornerBrackets } from "@/components/corner-brackets"
import type { SecretBindingEntry } from "@/components/secrets/secret-binding-editor"
import { SecretBindingEditor } from "@/components/secrets/secret-binding-editor"
import { useCreateSandbox } from "@/hooks/use-sandboxes"
import { useTemplates } from "@/hooks/use-templates"
import type { CreateSandboxRequest } from "@/lib/api/types"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"
import { isSystemTemplate } from "@/lib/templates/is-system-template"

const DEFAULT_TEMPLATE = "superserve/base"

interface TemplatePickerItem {
  id: string
  name: string
  system: boolean
}

function TemplatePicker({
  value,
  items,
  onChange,
}: {
  value: string
  items: TemplatePickerItem[]
  onChange: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const current = items.find((i) => i.name === value)

  useEffect(() => setMounted(true), [])

  // Track trigger position for the portalled, fixed-positioned panel.
  // Re-measures on scroll / resize so the panel stays anchored even when
  // the dialog's inner scroll container moves.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const measure = () => {
      if (triggerRef.current)
        setRect(triggerRef.current.getBoundingClientRect())
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handlePointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handlePointer)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handlePointer)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  const panel =
    open && rect && mounted
      ? createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: rect.bottom + 4,
              left: rect.left,
              width: rect.width,
              zIndex: 100,
            }}
            className="max-h-60 overflow-y-auto border border-dashed border-border bg-surface shadow-lg"
          >
            {items.length === 0 ? (
              <div className="px-3 py-2 font-mono text-xs text-muted">
                No ready templates available
              </div>
            ) : (
              items.map((item) => {
                const selected = item.name === value
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onChange(item.name)
                      setOpen(false)
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "bg-brand/10 text-foreground"
                        : "text-foreground/80 hover:bg-surface-hover",
                    )}
                  >
                    <span className="font-mono">{item.name}</span>
                    {item.system && (
                      <span className="font-mono text-[10px] text-muted uppercase">
                        System
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center justify-between border border-input bg-background px-3 text-sm text-foreground",
          "focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono">{value}</span>
          {current?.system && (
            <span className="font-mono text-[10px] text-muted uppercase">
              System
            </span>
          )}
        </span>
        <CaretDownIcon
          className={cn(
            "size-4 shrink-0 text-muted transition-transform",
            open && "rotate-180",
          )}
          weight="light"
        />
      </button>
      {panel}
    </>
  )
}

type Mode = "form" | "code"
type Language = "typescript" | "python"

const LANGUAGES: { label: string; value: Language }[] = [
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
]

const INSTALL_COMMANDS: Record<Language, string> = {
  typescript: "npm install @superserve/sdk",
  python: "pip install superserve",
}

function getCreateSnippet(language: Language): string {
  if (language === "typescript") {
    return `import { Sandbox } from "@superserve/sdk"

const sandbox = await Sandbox.create({
  name: "my-sandbox",
  apiKey: "YOUR_API_KEY",
})
console.log(sandbox.id)`
  }

  return `from superserve import Sandbox

sandbox = Sandbox.create(
    name="my-sandbox",
    api_key="YOUR_API_KEY",
)
print(sandbox.id)`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy"}
      className="shrink-0 cursor-pointer text-muted transition-colors hover:text-foreground"
    >
      {copied ? (
        <CheckIcon className="size-4 text-success" weight="light" />
      ) : (
        <CopyIcon className="size-4" weight="light" />
      )}
    </button>
  )
}

interface FormState {
  name: string
  timeout: string
  autoDelete: string
  allowRules: string[]
  denyRules: string[]
  secretEntries: SecretBindingEntry[]
  envEntries: { key: string; value: string }[]
  metadataEntries: { key: string; value: string }[]
  templateRef?: string
}

/** Max auto-pause timeout (7 days) and auto-delete window (30 days), matching
 *  the control-plane API caps. */
export const MAX_TIMEOUT_SECONDS = 604800
export const MAX_AUTO_DELETE_SECONDS = 2592000

/**
 * Coerce a form string to a whole-second lifecycle window, or throw if the
 * value is one a `type="number"` field can still emit past its min/max — the
 * dialog submits from a click handler, not a validated form, so fractional,
 * out-of-range, and non-finite inputs (e.g. `Number("1e309")` → `Infinity`,
 * which `JSON.stringify` turns into `null` and the API reads as "disable")
 * reach here. Returns undefined for an empty (unset) field.
 */
export function parseWindowSeconds(
  raw: string,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (raw.trim() === "") return undefined
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(
      `${label} must be a whole number between ${min} and ${max}.`,
    )
  }
  return n
}

/**
 * Build the CreateSandboxRequest payload from the dialog's form state.
 *
 * Exported for unit testing. Keeps the network/env/metadata branches in
 * one place so we can assert shape without driving the full dialog UI.
 *
 * Throws if `timeout` or `autoDelete` hold an invalid number (see
 * {@link parseWindowSeconds}); the dialog surfaces the message as a toast.
 *
 * Rules:
 *  - `name` is trimmed.
 *  - `timeout` / `autoDelete` are only included when set, validated to a
 *    whole number in range.
 *  - `network` is only included when at least one allow or deny rule is
 *    non-empty. Within it, `allow_out` / `deny_out` are each only included
 *    when that specific list has entries.
 *  - `env_vars` / `metadata` are only included when at least one entry has
 *    a non-empty key. Empty string values are allowed but empty keys are
 *    dropped.
 *  - `secrets` is only included when at least one entry has both an env
 *    key and a secret name.
 *  - `template_id` is only included when `templateRef` is non-empty.
 */
export function buildCreateSandboxRequest(
  state: FormState,
): CreateSandboxRequest {
  const allowList = state.allowRules.map((r) => r.trim()).filter(Boolean)
  const denyList = state.denyRules.map((r) => r.trim()).filter(Boolean)
  const hasNetwork = allowList.length > 0 || denyList.length > 0

  const secrets: Record<string, string> = {}
  for (const entry of state.secretEntries) {
    const k = entry.key.trim()
    if (k && entry.secret) secrets[k] = entry.secret
  }

  const envVars: Record<string, string> = {}
  for (const entry of state.envEntries) {
    const k = entry.key.trim()
    if (k) envVars[k] = entry.value.trim()
  }

  const metadata: Record<string, string> = {}
  for (const entry of state.metadataEntries) {
    const k = entry.key.trim()
    if (k) metadata[k] = entry.value.trim()
  }

  const timeoutSeconds = parseWindowSeconds(
    state.timeout,
    "Timeout",
    1,
    MAX_TIMEOUT_SECONDS,
  )
  const autoDeleteSeconds = parseWindowSeconds(
    state.autoDelete,
    "Auto-delete",
    0,
    MAX_AUTO_DELETE_SECONDS,
  )

  return {
    name: state.name.trim(),
    ...(state.templateRef ? { from_template: state.templateRef } : {}),
    ...(timeoutSeconds !== undefined
      ? { timeout_seconds: timeoutSeconds }
      : {}),
    ...(autoDeleteSeconds !== undefined
      ? { auto_delete_seconds: autoDeleteSeconds }
      : {}),
    ...(hasNetwork
      ? {
          network: {
            ...(allowList.length > 0 ? { allow_out: allowList } : {}),
            ...(denyList.length > 0 ? { deny_out: denyList } : {}),
          },
        }
      : {}),
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    ...(Object.keys(envVars).length > 0 ? { env_vars: envVars } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

interface CreateSandboxDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  onCreated?: (sandboxId: string) => void
  /**
   * Template reference to launch the sandbox from — either a UUID or a
   * name. When set, the dialog shows a "From template" banner and the
   * create payload includes `template_id`.
   */
  initialTemplateRef?: string | null
}

export function CreateSandboxDialog({
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
  onCreated,
  initialTemplateRef,
}: CreateSandboxDialogProps = {}) {
  const posthog = usePostHog()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState("")
  const [timeout, setTimeout] = useState("")
  const [autoDelete, setAutoDelete] = useState("")
  const [allowRules, setAllowRules] = useState<string[]>([])
  const [denyRules, setDenyRules] = useState<string[]>([])
  const [secretEntries, setSecretEntries] = useState<SecretBindingEntry[]>([])
  const [envEntries, setEnvEntries] = useState<
    { key: string; value: string }[]
  >([])
  const [metadataEntries, setMetadataEntries] = useState<
    { key: string; value: string }[]
  >([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [mode, setMode] = useState<Mode>("form")
  const [language, setLanguage] = useState<Language>("typescript")
  const [hoveredMode, setHoveredMode] = useState<string | null>(null)
  const [hoveredLang, setHoveredLang] = useState<string | null>(null)
  const [templateRef, setTemplateRef] = useState<string>(
    initialTemplateRef ?? DEFAULT_TEMPLATE,
  )

  // Keep `templateRef` in sync when the caller changes `initialTemplateRef`
  // (e.g. a different Launch action was fired).
  useEffect(() => {
    setTemplateRef(initialTemplateRef ?? DEFAULT_TEMPLATE)
  }, [initialTemplateRef])

  const { data: templates } = useTemplates()
  const templateOptions = useMemo(() => {
    const list = templates ?? []
    const ready = list.filter((t) => t.status === "ready")
    // Sort: system templates first (ss/* curated), then team by name.
    return [...ready].toSorted((a, b) => {
      const aSys = isSystemTemplate(a)
      const bSys = isSystemTemplate(b)
      if (aSys !== bSys) return aSys ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [templates])

  const selectItems = useMemo(() => {
    const mapped = templateOptions.map((t) => ({
      id: t.id,
      name: t.name,
      system: isSystemTemplate(t),
    }))
    // Ensure the current value is always in the items list, even if the
    // templates query hasn't resolved yet.
    const names = new Set(mapped.map((t) => t.name))
    if (templateRef && !names.has(templateRef)) {
      return [
        {
          id: templateRef,
          name: templateRef,
          system: isSystemTemplate({ name: templateRef }),
        },
        ...mapped,
      ]
    }
    return mapped
  }, [templateOptions, templateRef])

  const createMutation = useCreateSandbox()
  const { addToast } = useToast()

  const handleReset = () => {
    setName("")
    setTimeout("")
    setAutoDelete("")
    setAllowRules([])
    setDenyRules([])
    setSecretEntries([])
    setEnvEntries([])
    setMetadataEntries([])
    setShowAdvanced(false)
    setMode("form")
    setTemplateRef(initialTemplateRef ?? DEFAULT_TEMPLATE)
  }

  const handleCreate = () => {
    let payload: CreateSandboxRequest
    try {
      payload = buildCreateSandboxRequest({
        name,
        timeout,
        autoDelete,
        allowRules,
        denyRules,
        secretEntries,
        envEntries,
        metadataEntries,
        templateRef: templateRef || undefined,
      })
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Invalid input", "error")
      return
    }

    posthog.capture(SANDBOX_EVENTS.CREATED, {
      has_timeout: !!timeout,
      has_auto_delete: !!autoDelete,
      has_network_rules: !!payload.network,
      allow_rule_count: payload.network?.allow_out?.length ?? 0,
      deny_rule_count: payload.network?.deny_out?.length ?? 0,
      secret_count: payload.secrets ? Object.keys(payload.secrets).length : 0,
      env_var_count: payload.env_vars
        ? Object.keys(payload.env_vars).length
        : 0,
      metadata_key_count: payload.metadata
        ? Object.keys(payload.metadata).length
        : 0,
      advanced_expanded: showAdvanced,
      from_template: !!payload.from_template,
    })

    createMutation.mutate(payload, {
      onSuccess: (sandbox) => {
        setOpen(false)
        handleReset()
        onCreated?.(sandbox.id)
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) handleReset()
      }}
    >
      {!hideTrigger && (
        <DialogTrigger render={<Button size="sm" />}>
          <PlusIcon className="size-3.5" weight="light" />
          Create sandbox
        </DialogTrigger>
      )}
      <DialogPopup className="max-w-xl [&>.absolute]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between gap-4 p-6 pb-4">
          <DialogTitle>Create Sandbox</DialogTitle>
          <nav
            className="flex items-center gap-1"
            onMouseLeave={() => setHoveredMode(null)}
          >
            {(["form", "code"] as const).map((m) => {
              const isActive = mode === m
              const isHovered = hoveredMode === m
              const label = m === "form" ? "Console" : "SDK"

              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  onMouseEnter={() => setHoveredMode(m)}
                  className={cn(
                    "relative inline-flex cursor-pointer items-center px-3 py-1 font-mono text-xs transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {isHovered && (
                    <motion.span
                      className="absolute inset-0 bg-brand/10"
                      layoutId="create-mode-hover"
                      transition={{
                        type: "spring",
                        bounce: 0.15,
                        duration: 0.4,
                      }}
                    />
                  )}
                  {isActive && !hoveredMode && (
                    <span className="absolute inset-0 bg-brand/10" />
                  )}
                  {isActive && (
                    <motion.span
                      className="pointer-events-none absolute inset-0"
                      layoutId="create-mode-active"
                      transition={{
                        type: "spring",
                        bounce: 0.15,
                        duration: 0.5,
                      }}
                    >
                      <CornerBrackets size="sm" />
                    </motion.span>
                  )}
                  <span className="relative">{label}</span>
                </button>
              )
            })}
          </nav>
        </DialogHeader>

        {mode === "form" ? (
          <>
            <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6 pt-4">
              <Field label="Sandbox Name" required>
                <Input
                  placeholder="my-sandbox"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              <Field
                label="Template"
                required
                description="Base image the sandbox boots from."
              >
                <TemplatePicker
                  value={templateRef}
                  items={selectItems}
                  onChange={setTemplateRef}
                />
              </Field>

              {/* TODO: re-enable when multiple snapshots are available
              <Field label="Snapshot" description="More snapshots coming soon">
                <Select defaultValue="base">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="base">superserve/base</SelectItem>
                  </SelectPopup>
                </Select>
              </Field>
              */}

              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex w-full cursor-pointer items-center gap-1.5 border-t border-dashed border-border pt-4 font-mono text-xs text-muted uppercase hover:text-foreground"
              >
                <CaretDownIcon
                  className={cn(
                    "size-3 transition-transform",
                    showAdvanced && "rotate-180",
                  )}
                  weight="bold"
                />
                Advanced Options
              </button>

              <AnimatePresence initial={false}>
                {showAdvanced && (
                  <motion.div
                    key="advanced"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-5">
                      <Field
                        label="Timeout"
                        description="Auto-pause after this many seconds (max 604800 = 7 days)"
                      >
                        <Input
                          type="number"
                          placeholder="No timeout"
                          min={1}
                          max={MAX_TIMEOUT_SECONDS}
                          value={timeout}
                          onChange={(e) => setTimeout(e.target.value)}
                        />
                      </Field>

                      <Field
                        label="Auto-delete"
                        description="Delete after this many seconds of continuous pause. 0 = delete as soon as it pauses; blank = keep forever. Max 2592000 (30 days)."
                      >
                        <Input
                          type="number"
                          placeholder="Keep forever"
                          min={0}
                          max={MAX_AUTO_DELETE_SECONDS}
                          value={autoDelete}
                          onChange={(e) => setAutoDelete(e.target.value)}
                        />
                      </Field>

                      <div className="space-y-4">
                        <span className="block text-sm font-medium text-foreground">
                          Network
                        </span>

                        <div className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2">
                          <span className="pt-1.5 text-xs text-muted">
                            Allow — domains or CIDRs
                          </span>
                          <div className="space-y-2">
                            {allowRules.map((rule, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <Input
                                  placeholder="api.openai.com"
                                  value={rule}
                                  onChange={(e) => {
                                    const updated = [...allowRules]
                                    updated[i] = e.target.value
                                    setAllowRules(updated)
                                  }}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="shrink-0"
                                  onClick={() =>
                                    setAllowRules(
                                      allowRules.filter((_, j) => j !== i),
                                    )
                                  }
                                >
                                  <TrashIcon
                                    className="size-3.5 text-muted"
                                    weight="light"
                                  />
                                </Button>
                              </div>
                            ))}
                            <Button
                              variant="outline"
                              size="sm"
                              className="ml-auto"
                              onClick={() => setAllowRules([...allowRules, ""])}
                            >
                              <PlusIcon className="size-3.5" weight="light" />
                              Add
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2">
                          <span className="pt-1.5 text-xs text-muted">
                            Deny — CIDRs
                          </span>
                          <div className="space-y-2">
                            {denyRules.map((rule, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <Input
                                  placeholder="0.0.0.0/0"
                                  value={rule}
                                  onChange={(e) => {
                                    const updated = [...denyRules]
                                    updated[i] = e.target.value
                                    setDenyRules(updated)
                                  }}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="shrink-0"
                                  onClick={() =>
                                    setDenyRules(
                                      denyRules.filter((_, j) => j !== i),
                                    )
                                  }
                                >
                                  <TrashIcon
                                    className="size-3.5 text-muted"
                                    weight="light"
                                  />
                                </Button>
                              </div>
                            ))}
                            <Button
                              variant="outline"
                              size="sm"
                              className="ml-auto"
                              onClick={() => setDenyRules([...denyRules, ""])}
                            >
                              <PlusIcon className="size-3.5" weight="light" />
                              Add
                            </Button>
                          </div>
                        </div>
                      </div>

                      <SecretBindingEditor
                        entries={secretEntries}
                        onChange={setSecretEntries}
                      />

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">
                            Environment Variables
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setEnvEntries([
                                ...envEntries,
                                { key: "", value: "" },
                              ])
                            }
                          >
                            <PlusIcon className="size-3.5" weight="light" />
                            Add
                          </Button>
                        </div>
                        {envEntries.map((entry, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              placeholder="KEY"
                              value={entry.key}
                              onChange={(e) => {
                                const updated = [...envEntries]
                                updated[i] = { ...entry, key: e.target.value }
                                setEnvEntries(updated)
                              }}
                              className="flex-1"
                            />
                            <Input
                              placeholder="value"
                              value={entry.value}
                              onChange={(e) => {
                                const updated = [...envEntries]
                                updated[i] = { ...entry, value: e.target.value }
                                setEnvEntries(updated)
                              }}
                              className="flex-1"
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0"
                              onClick={() =>
                                setEnvEntries(
                                  envEntries.filter((_, j) => j !== i),
                                )
                              }
                            >
                              <TrashIcon
                                className="size-3.5 text-muted"
                                weight="light"
                              />
                            </Button>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">
                            Metadata
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setMetadataEntries([
                                ...metadataEntries,
                                { key: "", value: "" },
                              ])
                            }
                          >
                            <PlusIcon className="size-3.5" weight="light" />
                            Add
                          </Button>
                        </div>
                        {metadataEntries.map((entry, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              placeholder="key"
                              value={entry.key}
                              onChange={(e) => {
                                const updated = [...metadataEntries]
                                updated[i] = { ...entry, key: e.target.value }
                                setMetadataEntries(updated)
                              }}
                              className="flex-1"
                            />
                            <Input
                              placeholder="value"
                              value={entry.value}
                              onChange={(e) => {
                                const updated = [...metadataEntries]
                                updated[i] = { ...entry, value: e.target.value }
                                setMetadataEntries(updated)
                              }}
                              className="flex-1"
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0"
                              onClick={() =>
                                setMetadataEntries(
                                  metadataEntries.filter((_, j) => j !== i),
                                )
                              }
                            >
                              <TrashIcon
                                className="size-3.5 text-muted"
                                weight="light"
                              />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!name.trim() || createMutation.isPending}
                onClick={handleCreate}
              >
                {createMutation.isPending ? "Creating..." : "Create Sandbox"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {/* Language tabs */}
            <LayoutGroup id="create-lang">
              <nav
                className="mx-6 flex items-center gap-1 border-b border-dashed border-border py-2"
                onMouseLeave={() => setHoveredLang(null)}
              >
                {LANGUAGES.map((lang) => {
                  const isActive = language === lang.value
                  const isHovered = hoveredLang === lang.value

                  return (
                    <button
                      key={lang.value}
                      type="button"
                      onClick={() => setLanguage(lang.value)}
                      onMouseEnter={() => setHoveredLang(lang.value)}
                      className={cn(
                        "relative inline-flex cursor-pointer items-center px-3 py-1.5 font-mono text-xs transition-colors",
                        isActive
                          ? "text-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {isHovered && (
                        <motion.span
                          className="absolute inset-0 bg-brand/10"
                          layoutId="create-lang-hover"
                          transition={{
                            type: "spring",
                            bounce: 0.15,
                            duration: 0.4,
                          }}
                        />
                      )}
                      {isActive && !hoveredLang && (
                        <span className="absolute inset-0 bg-brand/10" />
                      )}
                      {isActive && (
                        <motion.span
                          className="pointer-events-none absolute inset-0"
                          layoutId="create-lang-active"
                          transition={{
                            type: "spring",
                            bounce: 0.15,
                            duration: 0.5,
                          }}
                        >
                          <CornerBrackets size="sm" />
                        </motion.span>
                      )}
                      <span className="relative">{lang.label}</span>
                    </button>
                  )
                })}
              </nav>
            </LayoutGroup>

            <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6 pt-4">
              {/* Step 1: Install */}
              <div className="space-y-2">
                <span className="block text-sm font-medium text-foreground">
                  Install SDK
                </span>
                <div className="flex items-start border border-dashed border-border bg-background px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <HighlightedCode
                      code={INSTALL_COMMANDS[language]}
                      lang="bash"
                    />
                  </div>
                  <CopyButton text={INSTALL_COMMANDS[language]} />
                </div>
              </div>

              {/* Step 2: Create */}
              <div className="space-y-2">
                <span className="block text-sm font-medium text-foreground">
                  Create Sandbox
                </span>
                <div className="flex items-start border border-dashed border-border bg-background px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <HighlightedCode
                      code={getCreateSnippet(language)}
                      lang={language}
                    />
                  </div>
                  <CopyButton text={getCreateSnippet(language)} />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  )
}
