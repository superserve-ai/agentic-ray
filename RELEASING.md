# Releasing

How to publish new versions of the Superserve SDKs.

## TypeScript SDK to npm

From the repo root:

```bash
# 1. Bump the version in BOTH places (keep them identical):
#    - packages/sdk/package.json
#    - packages/sdk/src/http.ts → SDK_VERSION (feeds the User-Agent)
# 2. Build + publish
bunx turbo run build --filter=@superserve/sdk
cd packages/sdk
NPM_CONFIG_TOKEN=npm_... bun publish --access public
```

Or with `.env.release` sourced:

```bash
source .env.release
bunx turbo run build --filter=@superserve/sdk
cd packages/sdk && bun publish --access public
```

## Python SDK to PyPI

**Important:** `uv build` must run from the **repo root** (uv workspaces put artifacts in root `dist/`). Bump the version in three places (keep them identical):

1. `packages/python-sdk/pyproject.toml` → `version = "..."`
2. `packages/python-sdk/src/superserve/__init__.py` → `__version__ = "..."`
3. `packages/python-sdk/src/superserve/_http.py` → `SDK_VERSION = "..."` (feeds the User-Agent)

```bash
uv build --package superserve
UV_PUBLISH_TOKEN=pypi-... uv publish dist/superserve-<version>*
```

Or with `.env.release` sourced:

```bash
source .env.release
uv build --package superserve
uv publish dist/superserve-*
```

## Release environment setup

Copy `.env.release.example` to `.env.release`, fill in tokens, and `source` it before running publish commands. `.env.release` is gitignored.

| Env variable       | Used by                   | How to get it                                                                             |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------- |
| `NPM_CONFIG_TOKEN` | `bun publish` (TS SDK)    | [npmjs.com](https://www.npmjs.com) → account → access tokens → automation token           |
| `UV_PUBLISH_TOKEN` | `uv publish` (Python SDK) | [pypi.org](https://pypi.org/manage/account/) → account → API tokens (starts with `pypi-`) |

## CI workflow (GitHub Actions)

| Workflow         | Trigger                      | Action                                                                                                                        |
| ---------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Release SDKs** | Manual (`workflow_dispatch`) | Bumps version, builds, publishes to npm and/or PyPI, commits + tags. Inputs: `package` (`ts` / `python` / `both`), `version`. |

Required repo secrets:

| Secret       | Used by               |
| ------------ | --------------------- |
| `NPM_TOKEN`  | Release SDKs (ts)     |
| `PYPI_TOKEN` | Release SDKs (python) |
