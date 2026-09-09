# Contributing to Superserve

Thank you for your interest in contributing to Superserve! We welcome contributions from the community.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) for TypeScript projects
- Python 3.12+ and [uv](https://github.com/astral-sh/uv) for the Python SDK

### Development Setup

1. Fork the repository on GitHub.

2. Clone your fork locally:

   ```bash
   git clone https://github.com/YOUR_USERNAME/superserve.git
   cd superserve
   ```

3. Create a new branch for your changes:

   ```bash
   git checkout -b my-feature-branch
   ```

4. Install dependencies:

   ```bash
   bun install
   ```

5. Run a build to verify setup:
   ```bash
   bun run build
   ```

## Repo Structure

```
apps/console/              # Sandbox dashboard (Next.js 16, App Router)
apps/mcp/                  # MCP host API endpoint
apps/ui-docs/              # UI component documentation (Vite)
docs/                      # Mintlify documentation site
packages/cli/              # TypeScript CLI (@superserve/cli)
packages/mcp/              # MCP server implementation (@superserve/mcp)
packages/python-sdk/       # Python SDK (superserve on PyPI)
packages/sdk/              # TypeScript SDK (@superserve/sdk)
packages/ui/               # Shared UI components (@superserve/ui)
packages/typescript-config/ # Shared tsconfig presets
packages/tailwind-config/  # Shared Tailwind config
tests/                     # End-to-end SDK tests
```

## Common Commands

```bash
bun run build              # build all packages
bun run dev                # start all dev servers
bun run lint               # lint all packages
bun run format             # format all files in place
bun run typecheck          # type check all packages
bun run test               # run all tests
```

For a single package:

```bash
bunx turbo run dev --filter=@superserve/console
```

For the Python SDK:

```bash
uv sync
uv run pytest packages/python-sdk/tests/
uv run ruff check packages/python-sdk/ --fix
uv run mypy packages/python-sdk/src/superserve
```

## Adding dependencies

Always add dependencies from the repo root using `--filter`:

```bash
bun add zod --filter @superserve/cli
bun add react --filter @superserve/console
bun add -d @types/node --filter @superserve/sdk
```

> **Note:** Do not `cd` into a package directory and run `bun add` — it creates a separate `bun.lock` that conflicts with the monorepo's root lockfile.

## E2E tests

E2E tests hit the live API and require an API key. Without `SUPERSERVE_API_KEY`, they skip cleanly (exit 0).

```bash
SUPERSERVE_API_KEY=ss_live_... bun run test:e2e          # default: staging
```

Override the target environment with `SUPERSERVE_BASE_URL`:

```bash
# Production
SUPERSERVE_API_KEY=ss_live_... \
  SUPERSERVE_BASE_URL=https://api.superserve.ai \
  bun run test:e2e

# Local backend
SUPERSERVE_API_KEY=ss_dev_... \
  SUPERSERVE_BASE_URL=http://localhost:8080 \
  bun run test:e2e
```

Run just one language:

```bash
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-ts
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-py
```

## How to Contribute

### Reporting Bugs

- Check existing [issues](https://github.com/superserve-ai/superserve/issues) to avoid duplicates
- Use a clear, descriptive title
- Include steps to reproduce the issue
- Provide relevant environment details (OS, runtime version, etc.)

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case and expected behavior
- Explain why this would be useful to other users

### Pull Requests

1. Create a branch from `main`

2. Make your changes and write tests if applicable

3. Ensure all checks pass:

   ```bash
   bun run lint
   bun run typecheck
   bun run test
   bun run build
   ```

4. Commit with a clear message:

   ```bash
   git commit -m "feat: add your feature description"
   ```

5. Push and open a Pull Request

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `refactor:` - Code changes that neither fix bugs nor add features
- `chore:` - Maintenance tasks

## Code Style

- [oxlint](https://oxc.rs) for TypeScript linting and [oxfmt](https://oxc.rs) for formatting (Tailwind classes auto-sorted)
- [Ruff](https://github.com/astral-sh/ruff) for Python linting and formatting
- [mypy](https://mypy-lang.org/) for Python type checking
- Type hints are encouraged in both TypeScript and Python

## Questions?

Feel free to open an issue for any questions or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the Open Core Ventures Source Available License (OCVSAL) 1.0.
