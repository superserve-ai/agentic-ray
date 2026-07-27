<div align="center">
  <br/>
  <br/>
  <picture>
    <img width="1500" height="auto" alt="Twitter Header - Personal" src="https://github.com/user-attachments/assets/ba41a4ed-1c8b-4826-bd3d-6fc8d84472ae" />
  </picture>

  <br/>
  <br/>

  <p><strong>Persistent and secure sandboxes for AI Agents, powered by Firecracker microVMs.</strong></p>

[![Docs](https://img.shields.io/badge/Docs-latest-blue)](https://docs.superserve.ai/?utm_source=github&utm_medium=readme)
[![License](https://img.shields.io/badge/license-Apache%20License%202.0-blue)](https://github.com/superserve-ai/superserve/blob/main/LICENSE)

</div>

## Getting Started

Visit [superserve.ai](https://www.superserve.ai/?utm_source=github&utm_medium=referral&utm_campaign=readme) or jump straight into the [docs](https://docs.superserve.ai/?utm_source=github&utm_medium=referral&utm_campaign=readme).

## Structure

```
apps/
  console/                 # Sandbox dashboard (Next.js 16, App Router)
  ui-docs/                 # UI component docs (Vite)
packages/
  cli/                     # TypeScript CLI (@superserve/cli)
  python-sdk/              # Python SDK (superserve on PyPI)
  sdk/                     # TypeScript SDK (@superserve/sdk)
  ui/                      # Shared UI components (@superserve/ui)
  typescript-config/       # Shared tsconfig presets
  tailwind-config/         # Shared Tailwind config
docs/                      # Mintlify documentation site
tests/                     # SDK end-to-end tests
```

Monorepo managed with [Bun workspaces](https://bun.sh/docs/install/workspaces), [Turborepo](https://turbo.build/repo), and [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/).

## Setup

```bash
bun install               # install all JS/TS dependencies
uv sync                   # install all Python dependencies
```

## Development

```bash
bun run dev               # start all dev servers
bun run build             # build all packages
bun run lint              # lint all files
bun run format            # format all files
bun run typecheck         # type check all packages
bun run test              # unit/integration tests
```

For more (per-package targets, dependency management, etc.), see [CONTRIBUTING.md](./CONTRIBUTING.md).

## SDKs

- TypeScript: [`@superserve/sdk`](https://www.npmjs.com/package/@superserve/sdk) — `bun add @superserve/sdk`
- Python: [`superserve`](https://pypi.org/project/superserve/) — `uv add superserve`

Full reference at [docs.superserve.ai](https://docs.superserve.ai/?utm_source=github&utm_medium=referral&utm_campaign=readme).

## Testing

```bash
bun run test                                        # unit tests (no credentials)
SUPERSERVE_API_KEY=ss_live_... bun run test:e2e     # e2e against staging
```

For environment overrides and single-language runs, see [CONTRIBUTING.md](./CONTRIBUTING.md#e2e-tests).

## Releasing

See [RELEASING.md](./RELEASING.md) for publishing the SDKs to npm and PyPI.

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

Apache License 2.0 — see [LICENSE](./LICENSE).

## Where to find us

- [Email us](mailto:engineering@superserve.ai)
- [Twitter/X](https://x.com/superserve_ai)
- [LinkedIn](https://www.linkedin.com/company/super-serve-ai)
