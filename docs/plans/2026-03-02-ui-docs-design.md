# UI Docs App Design

## Overview

A React + Vite SPA at `apps/ui-docs` that showcases all `@superserve/ui` components. Per-component pages with manual props tables, inline code examples with Shiki syntax highlighting, and a home page component grid.

Designed to serve as both an internal development reference and eventually public-facing component documentation.

## Tech Stack

- React 19, Vite 7, React Router v7
- Tailwind CSS 4 (via `@tailwindcss/vite`)
- Shiki (syntax highlighting)
- `@superserve/ui` (workspace dependency)
- `@superserve/biome-config`, `@superserve/typescript-config` (shared configs)

No MDX, no SSR, no build-time extraction. Pure client-side SPA.

## Directory Structure

```
apps/ui-docs/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── biome.json
├── vercel.json                     # SPA catch-all rewrite
├── src/
│   ├── main.tsx                    # React root + router
│   ├── app.tsx                     # Shell layout (sidebar + content)
│   ├── styles/
│   │   └── globals.css             # Imports @superserve/ui/styles + app overrides
│   ├── registry/
│   │   ├── index.ts                # Component registry with metadata
│   │   └── types.ts                # Registry types (PropDef, ComponentMeta, etc.)
│   ├── examples/
│   │   ├── button.tsx              # Button examples (rendered + source strings)
│   │   ├── badge.tsx
│   │   └── ... (one per component)
│   ├── pages/
│   │   ├── home.tsx                # Landing page — component grid overview
│   │   └── component-page.tsx      # Dynamic route — renders any component's docs
│   └── components/
│       ├── layout/
│       │   └── sidebar.tsx         # Navigation sidebar
│       ├── props-table.tsx         # Renders a prop definition table
│       ├── code-block.tsx          # Shiki-highlighted code display
│       ├── example-preview.tsx     # Component preview with code toggle
│       └── component-grid.tsx      # Card grid for home page
```

## Architecture: Centralized Registry

A single `registry/index.ts` maps every component to its metadata. A dynamic route `/components/:slug` looks up the slug and renders a shared `ComponentPage` layout.

### Registry Types

```ts
type PropDef = {
  name: string
  type: string
  default?: string
  required?: boolean
  description: string
}

type ComponentExample = {
  title: string
  preview: React.ReactNode
  code: string
}

type Category = "Inputs" | "Feedback" | "Data Display" | "Overlays" | "Layout"

type ComponentMeta = {
  slug: string
  name: string
  description: string
  category: Category
  source: string
  props: PropDef[]
  examples: ComponentExample[]
}
```

### Component Categories

- **Inputs:** Button, Input, Textarea, Checkbox, RadioGroup, Switch, Select, FormField
- **Feedback:** Badge, Alert, Progress, Toast, Tooltip
- **Data Display:** Avatar, Card, Table, Tabs, Accordion, Breadcrumbs, Kbd, Skeleton
- **Overlays:** Dialog, ConfirmDialog, DropdownMenu, Popover
- **Layout:** Separator

## Routes

```
/                          → Home (component card grid)
/components/:slug          → Component page (dynamic)
```

Two routes total. Unknown slugs show a 404.

## Page Layouts

### Home Page

Grid of cards grouped by category. Each card shows component name, one-line description, and a small inline preview. Cards use `Card`, `CardHeader`, `CardTitle`, `CardDescription` from `@superserve/ui`. Clicking navigates to `/components/{slug}`.

### Component Page

Top to bottom:
1. **Header** — name, description, link to source file
2. **Examples** — preview panels (rendered component on dotted/grid background) with "Show code" toggle revealing Shiki-highlighted source
3. **Props table** — Prop, Type, Default, Description columns using `@superserve/ui` Table components

### Shell Layout

- Left sidebar (fixed width) with logo/title, then component list grouped by category
- Main content area (scrollable) renders current page
- No top header — sidebar handles all navigation
- Sidebar collapsible on mobile

## Example File Pattern

Each component has an examples file exporting both rendered JSX and raw source strings:

```ts
// examples/button.tsx
import { Button } from "@superserve/ui"

export const examples: ComponentExample[] = [
  {
    title: "Variants",
    preview: (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="default">Default</Button>
        <Button variant="destructive">Destructive</Button>
      </div>
    ),
    code: `<Button variant="default">Default</Button>
<Button variant="destructive">Destructive</Button>`,
  },
]
```

## Visual Design

Dogfoods `@superserve/ui` throughout:
- Props tables use Table components
- Home cards use Card components
- Code toggles use Button with ghost/outline variant
- Type annotations use Badge with muted variant
- Section dividers use Separator

Theme inherits `@superserve/ui/styles` directly (teal primary, dashed borders, oklch colors). Same font stack (Inter, Geist Mono, Funnel Display).

Example preview panels render inside bordered containers with a subtle dotted/grid background pattern to distinguish previews from surrounding docs.

## Code Blocks

Shiki for syntax highlighting:
- TSX language detection
- Copy button (top-right corner)
- Matches the app's dark theme

## Deployment

`vercel.json` with SPA catch-all:
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```
