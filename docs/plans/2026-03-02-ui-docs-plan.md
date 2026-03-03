# UI Docs App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `apps/ui-docs`, a React + Vite SPA that showcases all `@superserve/ui` components with per-component pages, props tables, code examples, and a home page grid.

**Architecture:** Centralized registry pattern — a single `registry/index.ts` maps every component to its metadata. A dynamic React Router route `/components/:slug` renders any component's docs via a shared `ComponentPage` layout. Shiki provides syntax highlighting for code examples.

**Tech Stack:** React 19, Vite 7, React Router v7, Tailwind CSS 4, Shiki, `@superserve/ui` (workspace)

**Design Doc:** `docs/plans/2026-03-02-ui-docs-design.md`

---

### Task 1: Scaffold the app with config files

**Files:**
- Create: `apps/ui-docs/package.json`
- Create: `apps/ui-docs/vite.config.ts`
- Create: `apps/ui-docs/tsconfig.json`
- Create: `apps/ui-docs/tsconfig.app.json`
- Create: `apps/ui-docs/tsconfig.node.json`
- Create: `apps/ui-docs/biome.json`
- Create: `apps/ui-docs/vercel.json`
- Create: `apps/ui-docs/index.html`

**Step 1: Create package.json**

```json
{
  "name": "@superserve/ui-docs",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "bunx biome check .",
    "typecheck": "tsc -b"
  },
  "dependencies": {
    "@superserve/ui": "workspace:*",
    "@tailwindcss/vite": "^4.2.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7",
    "shiki": "^3",
    "tailwindcss": "^4.2.1"
  },
  "devDependencies": {
    "@superserve/biome-config": "workspace:*",
    "@superserve/typescript-config": "workspace:*",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.1.4",
    "typescript": "~5.9.3",
    "vite": "^7.3.1"
  }
}
```

**Step 2: Create vite.config.ts**

```ts
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [tailwindcss(), react()],
})
```

**Step 3: Create tsconfig.json**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**Step 4: Create tsconfig.app.json**

```json
{
  "extends": "@superserve/typescript-config/react-app.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

**Step 5: Create tsconfig.node.json**

```json
{
  "extends": "@superserve/typescript-config/react-app.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo"
  },
  "include": ["vite.config.ts"]
}
```

**Step 6: Create biome.json**

```json
{
  "extends": ["@superserve/biome-config/biome.json"]
}
```

**Step 7: Create vercel.json**

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**Step 8: Create index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
    <title>Superserve UI</title>
  </head>
  <body class="h-screen antialiased">
    <div id="root" class="h-full"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 9: Install dependencies**

Run: `bun install` (from repo root)

**Step 10: Verify the app scaffolding compiles**

Run: `bunx turbo run typecheck --filter=@superserve/ui-docs`
Expected: PASS (no source files yet, but config should resolve)

**Step 11: Commit**

```bash
git add apps/ui-docs/
git commit -m "feat: scaffold ui-docs app with config files"
```

---

### Task 2: Create entry point, CSS, and shell layout

**Files:**
- Create: `apps/ui-docs/src/main.tsx`
- Create: `apps/ui-docs/src/app.tsx`
- Create: `apps/ui-docs/src/styles/globals.css`
- Create: `apps/ui-docs/src/components/layout/sidebar.tsx`

**Step 1: Create globals.css**

```css
@import "@superserve/ui/styles";
@source "../../../../packages/ui/src";

:root {
  --sans-font: "Inter", system-ui, -apple-system, sans-serif;
  --mono-font: "Geist Mono", ui-monospace, monospace;
  --display-font: "Inter", system-ui, -apple-system, sans-serif;
}

::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #d4d4d4;
}
::-webkit-scrollbar-thumb:hover {
  background: #a3a3a3;
}
```

**Step 2: Create sidebar.tsx**

The sidebar renders component links grouped by category. It reads from a `CATEGORIES` constant (defined here temporarily, will move to registry later).

```tsx
import { Link, useParams } from "react-router"
import { Separator } from "@superserve/ui"

const CATEGORIES = [
  {
    name: "Inputs",
    items: [
      { slug: "button", name: "Button" },
      { slug: "input", name: "Input" },
      { slug: "textarea", name: "Textarea" },
      { slug: "checkbox", name: "Checkbox" },
      { slug: "radio-group", name: "Radio Group" },
      { slug: "switch", name: "Switch" },
      { slug: "select", name: "Select" },
      { slug: "form-field", name: "Form Field" },
    ],
  },
  {
    name: "Feedback",
    items: [
      { slug: "badge", name: "Badge" },
      { slug: "alert", name: "Alert" },
      { slug: "progress", name: "Progress" },
      { slug: "toast", name: "Toast" },
      { slug: "tooltip", name: "Tooltip" },
    ],
  },
  {
    name: "Data Display",
    items: [
      { slug: "avatar", name: "Avatar" },
      { slug: "card", name: "Card" },
      { slug: "table", name: "Table" },
      { slug: "tabs", name: "Tabs" },
      { slug: "accordion", name: "Accordion" },
      { slug: "breadcrumbs", name: "Breadcrumbs" },
      { slug: "kbd", name: "Kbd" },
      { slug: "skeleton", name: "Skeleton" },
    ],
  },
  {
    name: "Overlays",
    items: [
      { slug: "dialog", name: "Dialog" },
      { slug: "confirm-dialog", name: "Confirm Dialog" },
      { slug: "dropdown-menu", name: "Dropdown Menu" },
      { slug: "popover", name: "Popover" },
    ],
  },
  {
    name: "Layout",
    items: [
      { slug: "separator", name: "Separator" },
    ],
  },
]

export function Sidebar() {
  const { slug } = useParams()

  return (
    <aside className="w-56 shrink-0 border-r border-dashed border-border overflow-y-auto p-4">
      <Link to="/" className="block mb-4">
        <p className="text-sm font-semibold text-foreground">Superserve UI</p>
      </Link>
      <Separator className="mb-4" />
      <nav className="space-y-4">
        {CATEGORIES.map((cat) => (
          <div key={cat.name}>
            <p className="text-xs font-mono uppercase tracking-wider text-muted mb-1.5 px-3">
              {cat.name}
            </p>
            <div className="space-y-0.5">
              {cat.items.map((item) => (
                <Link
                  key={item.slug}
                  to={`/components/${item.slug}`}
                  className={`block w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    slug === item.slug
                      ? "bg-surface-hover text-foreground font-medium"
                      : "text-muted hover:text-foreground hover:bg-surface-hover"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
```

**Step 3: Create app.tsx**

```tsx
import { Outlet } from "react-router"
import { ToastProvider, TooltipProvider } from "@superserve/ui"
import { Sidebar } from "./components/layout/sidebar"

export default function App() {
  return (
    <ToastProvider>
      <TooltipProvider>
        <div className="flex h-screen bg-background text-foreground">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </TooltipProvider>
    </ToastProvider>
  )
}
```

**Step 4: Create main.tsx**

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes } from "react-router"

import App from "./app"
import "./styles/globals.css"

function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted mt-2">Coming soon.</p>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Placeholder title="Superserve UI" />} />
          <Route path="components/:slug" element={<Placeholder title="Component" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
```

**Step 5: Verify the app runs**

Run: `bunx turbo run dev --filter=@superserve/ui-docs`
Expected: Vite dev server starts, sidebar renders with component links, placeholder content shows.

**Step 6: Commit**

```bash
git add apps/ui-docs/src/
git commit -m "feat: add entry point, CSS, and shell layout with sidebar"
```

---

### Task 3: Create registry types and core UI components (PropsTable, CodeBlock, ExamplePreview)

**Files:**
- Create: `apps/ui-docs/src/registry/types.ts`
- Create: `apps/ui-docs/src/components/props-table.tsx`
- Create: `apps/ui-docs/src/components/code-block.tsx`
- Create: `apps/ui-docs/src/components/example-preview.tsx`

**Step 1: Create registry/types.ts**

```ts
import type { ReactNode } from "react"

export type PropDef = {
  name: string
  type: string
  default?: string
  required?: boolean
  description: string
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
```

**Step 2: Create props-table.tsx**

Uses `@superserve/ui` Table components. Renders the `PropDef[]` array.

```tsx
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import type { PropDef } from "../registry/types"

export function PropsTable({ props }: { props: PropDef[] }) {
  if (props.length === 0) return null

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3">Props</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Prop</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Default</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.map((prop) => (
            <TableRow key={prop.name}>
              <TableCell>
                <code className="font-mono text-xs text-foreground">{prop.name}</code>
                {prop.required && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="muted" className="font-mono text-[11px]">
                  {prop.type}
                </Badge>
              </TableCell>
              <TableCell>
                {prop.default ? (
                  <code className="font-mono text-xs text-muted">{prop.default}</code>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted">{prop.description}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

**Step 3: Create code-block.tsx**

Uses Shiki for highlighting. Highlights asynchronously and caches results.

```tsx
import { useEffect, useState } from "react"
import { codeToHtml } from "shiki"
import { Button } from "@superserve/ui"
import { Check, Copy } from "lucide-react"

const highlightCache = new Map<string, string>()

async function highlight(code: string): Promise<string> {
  const cached = highlightCache.get(code)
  if (cached) return cached

  const html = await codeToHtml(code, {
    lang: "tsx",
    theme: "github-dark-default",
  })
  highlightCache.set(code, html)
  return html
}

export function CodeBlock({ code }: { code: string }) {
  const [html, setHtml] = useState<string>("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    highlight(code).then(setHtml)
  }, [code])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group">
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
      <div
        className="overflow-x-auto border border-dashed border-border bg-[#0d1117] px-4 py-3 font-mono text-xs leading-relaxed [&_pre]:!bg-transparent [&_code]:!bg-transparent"
        dangerouslySetInnerHTML={html ? { __html: html } : undefined}
      />
    </div>
  )
}
```

**Step 4: Create example-preview.tsx**

A preview panel with rendered component + collapsible code block.

```tsx
import { useState } from "react"
import { Button } from "@superserve/ui"
import { Code, X } from "lucide-react"
import type { ComponentExample } from "../registry/types"
import { CodeBlock } from "./code-block"

export function ExamplePreview({ example }: { example: ComponentExample }) {
  const [showCode, setShowCode] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-mono text-muted">{example.title}</p>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setShowCode(!showCode)}
        >
          {showCode ? <X className="size-3.5" /> : <Code className="size-3.5" />}
        </Button>
      </div>
      <div className="border border-dashed border-border p-6 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,oklch(0.96_0.005_85)_10px,oklch(0.96_0.005_85)_11px)]">
        {example.preview}
      </div>
      {showCode && (
        <div className="mt-0">
          <CodeBlock code={example.code} />
        </div>
      )}
    </div>
  )
}
```

**Step 5: Verify typecheck passes**

Run: `bunx turbo run typecheck --filter=@superserve/ui-docs`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/ui-docs/src/registry/ apps/ui-docs/src/components/
git commit -m "feat: add registry types, PropsTable, CodeBlock, and ExamplePreview"
```

---

### Task 4: Create the ComponentPage and wire up routing

**Files:**
- Create: `apps/ui-docs/src/pages/component-page.tsx`
- Modify: `apps/ui-docs/src/main.tsx`

**Step 1: Create component-page.tsx**

This reads the slug from the URL, looks up the component in a registry (imported later), and renders header + examples + props table. For now, use a stub registry with one component to test the layout.

```tsx
import { useParams, Link } from "react-router"
import { Separator } from "@superserve/ui"
import { ExamplePreview } from "../components/example-preview"
import { PropsTable } from "../components/props-table"
import type { ComponentMeta } from "../registry/types"

// Temporary stub — will be replaced by real registry in Task 5
const STUB_REGISTRY: ComponentMeta[] = []

export function ComponentPage({
  registry,
}: {
  registry: ComponentMeta[]
}) {
  const { slug } = useParams()
  const meta = registry.find((c) => c.slug === slug)

  if (!meta) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-foreground">Not Found</h1>
        <p className="text-muted mt-2">
          Component "{slug}" does not exist.{" "}
          <Link to="/" className="text-primary-light underline underline-offset-2">
            Go home
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">{meta.name}</h1>
        <p className="text-muted mt-1">{meta.description}</p>
        <p className="text-xs font-mono text-muted mt-2">
          Source:{" "}
          <code className="text-primary-light">{meta.source}</code>
        </p>
      </div>

      <div className="space-y-8">
        {meta.examples.map((example) => (
          <ExamplePreview key={example.title} example={example} />
        ))}
      </div>

      {meta.props.length > 0 && (
        <>
          <Separator className="my-8" />
          <PropsTable props={meta.props} />
        </>
      )}
    </div>
  )
}
```

**Step 2: Update main.tsx to wire up real routing**

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes } from "react-router"

import App from "./app"
import { ComponentPage } from "./pages/component-page"
import "./styles/globals.css"

// Temporary empty registry — will be populated in Task 5+
const registry: import("./registry/types").ComponentMeta[] = []

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-foreground">Superserve UI</h1>
      <p className="text-muted mt-2">Component library documentation.</p>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Home />} />
          <Route
            path="components/:slug"
            element={<ComponentPage registry={registry} />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
```

**Step 3: Verify the app runs and 404 page works**

Run: `bunx turbo run dev --filter=@superserve/ui-docs`
Navigate to `/components/nonexistent` — should show "Not Found" message.

**Step 4: Commit**

```bash
git add apps/ui-docs/src/
git commit -m "feat: add ComponentPage with routing and 404 handling"
```

---

### Task 5: Create example files for first batch of components (Inputs category)

**Files:**
- Create: `apps/ui-docs/src/examples/button.tsx`
- Create: `apps/ui-docs/src/examples/input.tsx`
- Create: `apps/ui-docs/src/examples/textarea.tsx`
- Create: `apps/ui-docs/src/examples/checkbox.tsx`
- Create: `apps/ui-docs/src/examples/radio-group.tsx`
- Create: `apps/ui-docs/src/examples/switch.tsx`
- Create: `apps/ui-docs/src/examples/select.tsx`
- Create: `apps/ui-docs/src/examples/form-field.tsx`

Each file exports a `ComponentMeta` object with slug, name, description, category, source path, props array, and examples array. Examples are ported from the existing preview page at `/Users/nirnejak/Code/superserve/platform/app/src/app/preview/page.tsx`.

**Step 1: Create all 8 example files**

Each file follows this pattern (showing button.tsx as the template):

```tsx
// examples/button.tsx
import { Button } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const buttonMeta: ComponentMeta = {
  slug: "button",
  name: "Button",
  description: "A clickable button with multiple variants and sizes.",
  category: "Inputs",
  source: "components/button.tsx",
  props: [
    {
      name: "variant",
      type: '"default" | "destructive" | "outline" | "ghost" | "link"',
      default: '"default"',
      description: "The visual style of the button.",
    },
    {
      name: "size",
      type: '"default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg"',
      default: '"default"',
      description: "The size of the button.",
    },
    {
      name: "asChild",
      type: "boolean",
      default: "false",
      description: "Render as a child element using Radix Slot.",
    },
  ],
  examples: [
    {
      title: "Variants",
      preview: (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="default">Default</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
        </div>
      ),
      code: `<Button variant="default">Default</Button>
<Button variant="destructive">Destructive</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>`,
    },
    {
      title: "Sizes",
      preview: (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
        </div>
      ),
      code: `<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>`,
    },
    {
      title: "Disabled",
      preview: (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>Disabled Outline</Button>
        </div>
      ),
      code: `<Button disabled>Disabled</Button>
<Button variant="outline" disabled>Disabled Outline</Button>`,
    },
  ],
}
```

Create similar files for: `input.tsx`, `textarea.tsx`, `checkbox.tsx`, `radio-group.tsx`, `switch.tsx`, `select.tsx`, `form-field.tsx`.

Use the exact props from the component source files (documented in the design doc) and port examples from the platform preview page.

**Props reference for each component:**

**input.tsx** props: `label` (string), `error` (string), `description` (string), `suffix` (ReactNode), `wrapperClassName` (string) — all optional.

**textarea.tsx** props: `label` (string), `error` (string), `description` (string) — all optional.

**checkbox.tsx** props: `label` (string) — optional.

**radio-group.tsx** — RadioGroup has no custom props. RadioGroupItem props: `label` (string) — optional.

**switch.tsx** props: `label` (string) — optional.

**select.tsx** — Select has no custom props. SelectContent props: `position` ("popper" | "item-aligned", default "popper"). SelectTrigger, SelectItem, SelectValue have no custom props.

**form-field.tsx** props: `label` (string, required), `htmlFor` (string), `error` (string), `description` (string), `required` (boolean).

**Step 2: Commit**

```bash
git add apps/ui-docs/src/examples/
git commit -m "feat: add example files for Inputs category components"
```

---

### Task 6: Create example files for remaining categories (Feedback, Data Display, Overlays, Layout)

**Files:**
- Create: `apps/ui-docs/src/examples/badge.tsx`
- Create: `apps/ui-docs/src/examples/alert.tsx`
- Create: `apps/ui-docs/src/examples/progress.tsx`
- Create: `apps/ui-docs/src/examples/toast.tsx`
- Create: `apps/ui-docs/src/examples/tooltip.tsx`
- Create: `apps/ui-docs/src/examples/avatar.tsx`
- Create: `apps/ui-docs/src/examples/card.tsx`
- Create: `apps/ui-docs/src/examples/table.tsx`
- Create: `apps/ui-docs/src/examples/tabs.tsx`
- Create: `apps/ui-docs/src/examples/accordion.tsx`
- Create: `apps/ui-docs/src/examples/breadcrumbs.tsx`
- Create: `apps/ui-docs/src/examples/kbd.tsx`
- Create: `apps/ui-docs/src/examples/skeleton.tsx`
- Create: `apps/ui-docs/src/examples/dialog.tsx`
- Create: `apps/ui-docs/src/examples/confirm-dialog.tsx`
- Create: `apps/ui-docs/src/examples/dropdown-menu.tsx`
- Create: `apps/ui-docs/src/examples/popover.tsx`
- Create: `apps/ui-docs/src/examples/separator.tsx`

**Step 1: Create all 18 example files**

Follow the same pattern as Task 5. Each file exports a `ComponentMeta` object.

**Props reference:**

**badge.tsx** props: `variant` ("default" | "success" | "warning" | "destructive" | "muted", default "default"), `dot` (boolean, default false).

**alert.tsx** props: `variant` ("default" | "success" | "warning" | "destructive", default "default"), `title` (string).

**progress.tsx** props: `value` (number, required), `max` (number, default 100), `variant` ("default" | "success" | "warning" | "destructive", default "default").

**toast.tsx** — No component props (context-based). Document `useToast()` hook API: `addToast(input, variant?)`, `removeToast(id)`. Document `AddToastInput` type.

**tooltip.tsx** — TooltipContent props: `sideOffset` (number, default 4).

**avatar.tsx** props: `src` (string), `alt` (string), `fallback` (string, required), `size` ("xs" | "sm" | "default" | "lg", default "default").

**card.tsx** — No custom props (all compound components use standard HTML attributes).

**table.tsx** — No custom props (all compound components use standard HTML attributes).

**tabs.tsx** — No custom props (all from Radix).

**accordion.tsx** — No custom props (all from Radix).

**breadcrumbs.tsx** props: `items` (BreadcrumbItem[], required), `renderLink` (function).

**kbd.tsx** — No custom props.

**skeleton.tsx** — No custom props (just className).

**dialog.tsx** — DialogContent inherits from Radix. No custom props.

**confirm-dialog.tsx** props: `open` (boolean, required), `onOpenChange` (function, required), `title` (string, required), `description` (string, required), `confirmLabel` (string, default "Confirm"), `cancelLabel` (string, default "Cancel"), `variant` ("danger" | "warning", default "danger"), `onConfirm` (function, required), `isLoading` (boolean, default false).

**dropdown-menu.tsx** — DropdownMenuContent props: `sideOffset` (number, default 4).

**popover.tsx** — PopoverContent props: `align` ("start" | "center" | "end", default "center"), `sideOffset` (number, default 4).

**separator.tsx** props: `orientation` ("horizontal" | "vertical", default "horizontal").

**Note on interactive examples (Toast, Dialog, ConfirmDialog, Popover):** These need local state in the example. Wrap the preview in a small component function:

```tsx
// Example for toast.tsx
import { useState } from "react"
import { Button, useToast } from "@superserve/ui"

function ToastDemo() {
  const { addToast } = useToast()
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={() => addToast("Info toast", "info")}>Info</Button>
      <Button variant="outline" onClick={() => addToast("Success toast", "success")}>Success</Button>
    </div>
  )
}

// Use <ToastDemo /> as the preview
```

**Step 2: Commit**

```bash
git add apps/ui-docs/src/examples/
git commit -m "feat: add example files for Feedback, Data Display, Overlays, and Layout"
```

---

### Task 7: Build the registry and connect everything

**Files:**
- Create: `apps/ui-docs/src/registry/index.ts`
- Modify: `apps/ui-docs/src/main.tsx` (import registry, pass to routes)
- Modify: `apps/ui-docs/src/components/layout/sidebar.tsx` (read from registry instead of hardcoded list)

**Step 1: Create registry/index.ts**

Import all 26 component meta objects and export them as an array + helper functions.

```ts
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
```

**Step 2: Update main.tsx to use real registry**

Replace the empty registry with the imported one, and pass it to ComponentPage.

```tsx
import { registry } from "./registry"
// ... pass registry to <ComponentPage registry={registry} />
```

**Step 3: Update sidebar.tsx to read from registry**

Replace the hardcoded `CATEGORIES` with imports from the registry.

```tsx
import { categories, getByCategory } from "../../registry"
// Replace CATEGORIES with:
// categories.map(cat => ({ name: cat, items: getByCategory(cat) }))
```

**Step 4: Verify the full flow works**

Run: `bunx turbo run dev --filter=@superserve/ui-docs`
- Navigate to `/` — should show placeholder home
- Navigate to `/components/button` — should show Button page with examples, code toggle, and props table
- Navigate to `/components/badge` — should show Badge page
- Click sidebar links — should navigate between components
- Active sidebar item should highlight

**Step 5: Commit**

```bash
git add apps/ui-docs/src/
git commit -m "feat: build registry and connect all component pages"
```

---

### Task 8: Build the Home page with component grid

**Files:**
- Create: `apps/ui-docs/src/components/component-grid.tsx`
- Create: `apps/ui-docs/src/pages/home.tsx`
- Modify: `apps/ui-docs/src/main.tsx` (replace placeholder Home with real one)

**Step 1: Create component-grid.tsx**

A card grid that shows all components, grouped by category.

```tsx
import { Link } from "react-router"
import { Card, CardHeader, CardTitle, CardDescription } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export function ComponentGrid({
  title,
  components,
}: {
  title: string
  components: ComponentMeta[]
}) {
  return (
    <div>
      <h2 className="text-xs font-mono uppercase tracking-wider text-muted mb-3">
        {title}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {components.map((comp) => (
          <Link key={comp.slug} to={`/components/${comp.slug}`}>
            <Card className="h-full transition-colors hover:border-primary-light cursor-pointer">
              <CardHeader>
                <CardTitle className="text-sm">{comp.name}</CardTitle>
                <CardDescription className="text-xs">
                  {comp.description}
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

**Step 2: Create pages/home.tsx**

```tsx
import { categories, getByCategory } from "../registry"
import { ComponentGrid } from "../components/component-grid"

export function Home() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Superserve UI</h1>
        <p className="text-muted mt-1">
          Component library built with React, Radix UI, and Tailwind CSS.
        </p>
      </div>
      <div className="space-y-8">
        {categories.map((cat) => (
          <ComponentGrid
            key={cat}
            title={cat}
            components={getByCategory(cat)}
          />
        ))}
      </div>
    </div>
  )
}
```

**Step 3: Update main.tsx to use real Home page**

Replace the placeholder `Home` function with the imported `Home` component.

**Step 4: Verify the home page works**

Run: `bunx turbo run dev --filter=@superserve/ui-docs`
- Home page shows card grid with all 26 components grouped by category
- Clicking a card navigates to the component page

**Step 5: Commit**

```bash
git add apps/ui-docs/src/
git commit -m "feat: add home page with component card grid"
```

---

### Task 9: Polish, lint, and verify full build

**Files:**
- Possibly modify: any files with lint issues

**Step 1: Run linter and fix issues**

Run: `bunx turbo run lint --filter=@superserve/ui-docs`
Fix any Biome lint/format issues.

**Step 2: Run typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/ui-docs`
Expected: PASS

**Step 3: Run build**

Run: `bunx turbo run build --filter=@superserve/ui-docs`
Expected: Successful Vite build producing `dist/` output

**Step 4: Test the production build locally**

Run: `cd apps/ui-docs && bunx vite preview`
Verify the SPA works: home page, component pages, code highlighting, sidebar navigation.

**Step 5: Commit any lint fixes**

```bash
git add apps/ui-docs/
git commit -m "chore: fix lint issues and verify production build"
```

---

## Task Summary

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | Scaffold app with config files | — |
| 2 | Entry point, CSS, shell layout with sidebar | 1 |
| 3 | Registry types, PropsTable, CodeBlock, ExamplePreview | 1 |
| 4 | ComponentPage and routing | 2, 3 |
| 5 | Example files for Inputs category (8 components) | 3 |
| 6 | Example files for remaining categories (18 components) | 3 |
| 7 | Build registry, connect everything | 4, 5, 6 |
| 8 | Home page with component grid | 7 |
| 9 | Polish, lint, verify full build | 8 |
