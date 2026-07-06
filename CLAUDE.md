# CLAUDE.md

Superserve provides sandbox infrastructure (Firecracker microVMs) to run code in isolated cloud environments. This monorepo contains the console, CLI, TypeScript SDK, Python SDK, MCP server, and UI library.

For SDK usage, product concepts, and API reference, see [docs.superserve.ai](https://docs.superserve.ai) (LLM-friendly: `docs.superserve.ai/llms-full.txt`). The `superserve` skill contains the full SDK reference.

## Monorepo structure

```
apps/console/          # Next.js 16 console (App Router)
apps/ui-docs/          # UI component docs (Vite, port 3003)
packages/cli/          # TypeScript CLI (@superserve/cli)
packages/sdk/          # TypeScript SDK (@superserve/sdk)
packages/python-sdk/   # Python SDK (superserve on PyPI)
packages/ui/           # Shared UI component library (@superserve/ui)
packages/mcp/          # MCP server (@superserve/mcp)
tests/                 # SDK e2e tests (sdk-e2e-ts, sdk-e2e-py)
docs/                  # Mintlify site (docs.json)
```

Bun workspaces + Turborepo for JS/TS. uv workspaces for Python.

## Development

```bash
bun install && uv sync                              # setup
bun run dev / build / lint / format / typecheck / test
SUPERSERVE_API_KEY=ss_live_... bun run test:e2e     # credentialed SDK e2e
bunx turbo run build --filter=@superserve/sdk       # target a package
bun run docs:dev                                    # Mintlify preview
```

**Adding deps:** `bun add zod --filter @superserve/cli` — never `cd` into a package then `bun add`, it creates a conflicting lockfile.

**CLI locally:** `bun packages/cli/src/index.ts deploy --help`

**Python SDK:** `uv run pytest packages/python-sdk/tests/` · `uv run ruff check --fix` · `uv run mypy packages/python-sdk/src/superserve/`

**Lint/format fix:** `bunx oxlint --fix && bunx oxfmt --write` (pre-commit hook also runs this)

## Releasing SDKs

Keep TS and Python version numbers in sync:
- TS: `packages/sdk/package.json` → `version`
- Python: `packages/python-sdk/pyproject.toml` → `version` AND `packages/python-sdk/src/superserve/__init__.py` → `__version__`

Prefer the **Release SDKs** GitHub Actions workflow (`workflow_dispatch`). For manual publish:
- TS: `bunx turbo run build --filter=@superserve/sdk && cd packages/sdk && bun publish --access public`
- Python: run `uv build --package superserve && uv publish dist/superserve-*` from repo root (uv workspaces put artifacts there)

## Console architecture

**API Proxy** (`apps/console/src/app/api/[...path]/route.ts`): All browser sandbox API calls route through a Next.js proxy that authenticates via Supabase session, generates a server-side `X-API-Key`, and forwards to `SANDBOX_API_URL`. Proxy keys use the name `__console_proxy__` and are hidden from the UI.

**Server Actions** (`apps/console/src/lib/api/*-actions.ts`): API keys, snapshots, activity, and audit logs use the Supabase admin client directly, bypassing the proxy.

**Data fetching:** React Query with hooks in `src/hooks/`. Query keys in `src/lib/api/query-keys.ts`. Mutations use optimistic updates.

**API types:** `apps/console/src/lib/api/types.ts` — must match the OpenAPI spec.

## Coding style

**TypeScript:** oxlint + oxfmt (2-space, double quotes). Strict mode, ESM. Shared configs: TS extends `@superserve/typescript-config`; Tailwind from `@superserve/tailwind-config`; single root `.oxlintrc.json` / `.oxfmtrc.json`.

**Python:** ruff (lint + format, line length 88), mypy. Python ≥ 3.9.

## Design language

The console has a deliberate austere, technical aesthetic:

- **Colors:** Charcoal canvas (`#141414` bg, `#1c1c1c` surfaces, `#eaeaea` fg). Brand accent is **mint** (`--color-brand` `#b2fab4`) for all interactive/live states. Status: mint = running, green = ready/healthy, amber = transitional, red = failed. Tokens in `packages/tailwind-config/theme.css`.
- **Borders:** Dashed everywhere (`border border-dashed border-border`). The signature visual trait — no solid decorative borders.
- **Translucency:** Floating surfaces (dialogs, menus, command palette, toasts, sticky headers) use translucent bg + `backdrop-blur`. Body surfaces stay solid.
- **Typography:** Instrument Sans (sans) + Geist Mono (mono). Buttons, badges, table headers: `font-mono uppercase text-xs`.
- **Corners:** Sharp throughout — no border-radius.
- **Corner brackets:** `<CornerBrackets />` frames active/selected items (sidebar nav, language tabs, empty states). Sizes: `sm`, `md`, `lg`.
- **Animations:** Scale-based (0.96x → 1x) for dialogs/popovers. Spring sticky hover via `motion` `layoutId` for nav, table rows, tabs. Defined in `packages/ui/src/styles/globals.css`.
- **Icons:** Phosphor Icons, `weight="light"`. `size-4` inline, `size-3.5` for buttons.
- **Layout:** Collapsible sidebar (16px collapsed / 64px expanded). Pages: `PageHeader` (h-14) → optional `TableToolbar` → scrollable content. Settings: `grid-cols-[240px_1fr]`.

## Branding

- Platform is `Superserve`; CLI tool is `superserve`
- Never "Claude" standalone — always "Claude Agent" or "Claude Agent SDK"

## Git

- Single-line commit messages
- No "Co-Authored-By" or AI attribution in commits
