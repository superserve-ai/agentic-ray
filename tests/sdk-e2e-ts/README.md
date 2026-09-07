# @superserve/test-sdk-e2e-ts

End-to-end tests for `@superserve/sdk` against a live Superserve environment. Exercises every resource the TS SDK currently exposes — `system`, `sandboxes`, `exec` — with real API calls, real sandboxes, real command execution.

Built with [Vitest](https://vitest.dev) to match the rest of the monorepo (same runner the `apps/console` tests use). One test file per resource. Shared client factory and polling helpers in `src/`.

Imports `@superserve/sdk` directly from `packages/sdk/src` via tsconfig `paths` — no build step, no `dist/` indirection. Source changes in the SDK are picked up on the next `bun run e2e`.

**Not wired into `bun run test`.** These tests are credentialed, slow, and create real cloud resources. They run only when explicitly invoked.

## Structure

```
tests/sdk-e2e-ts/
├── vitest.config.ts          # serial runs, 60s test timeout, 120s hook timeout
├── src/
│   ├── client.ts             # createClient(), hasCredentials(), RUN_ID
│   └── polling.ts            # waitForStatus(client, id, expected, { timeoutMs })
└── tests/
    ├── system.test.ts        # client.system.health()
    ├── sandboxes.test.ts     # create, get, list, patch, pause, resume, delete
    ├── exec.test.ts          # command (sync + failing), commandStream (SSE)
    ├── network.test.ts       # strict allowlists, bare-IP rules, network log, update-while-paused
    └── cursor-worker.test.ts # the Cursor Self-Hosted Machines guide's template + worker helpers
```

`cursor-worker.test.ts` builds the guide's `cursor-worker` template on a team the first time it runs (about a minute) and reuses it afterwards. It needs no Cursor credentials: it exercises the template, the detached worker supervisor, the real worker binary's failure path, and the hibernate lookup, not a live Cursor pool.

Each test file owns its own sandbox via `beforeAll` / `afterAll` — the sandbox is created once per file, reused across tests in that file, and deleted in `afterAll` so cleanup runs even on failure. Sandbox names include a unique `RUN_ID` so orphans from crashed runs are identifiable for manual cleanup.

## Run

Defaults to **staging** (`https://api-staging.superserve.ai`):

```bash
cd tests/sdk-e2e-ts
SUPERSERVE_API_KEY=ss_... bun run e2e
```

From the repo root:

```bash
SUPERSERVE_API_KEY=ss_... bun run test:e2e
```

Watch mode (re-runs on file change):

```bash
SUPERSERVE_API_KEY=ss_... bun run e2e:watch
```

### Target a different environment

```bash
# production
SUPERSERVE_API_KEY=ss_live_... \
SUPERSERVE_BASE_URL=https://api.superserve.ai \
  bun run e2e

# local dev server
SUPERSERVE_API_KEY=ss_dev_... \
SUPERSERVE_BASE_URL=http://localhost:8080 \
  bun run e2e
```

### Without credentials

```bash
bun run e2e
```

Every `describe` block is guarded with `describe.skipIf(!hasCredentials())`. With no `SUPERSERVE_API_KEY` set, Vitest reports all suites as skipped and exits 0. Useful for sanity-checking that the tests at least parse and import correctly.

## Coverage

| Resource    | Method            | Covered            |
| ----------- | ----------------- | ------------------ |
| `system`    | `health()`        | ✓                  |
| `sandboxes` | `createSandbox()` | ✓                  |
| `sandboxes` | `getSandbox()`    | ✓                  |
| `sandboxes` | `listSandboxes()` | ✓                  |
| `sandboxes` | `patchSandbox()`  | ✓                  |
| `sandboxes` | `pauseSandbox()`  | ✓                  |
| `sandboxes` | `resumeSandbox()` | ✓                  |
| `sandboxes` | `deleteSandbox()` | ✓ (via `afterAll`) |
| `exec`      | `command()`       | ✓                  |
| `exec`      | `commandStream()` | ✓                  |

The TS SDK does not currently expose a `files` resource — the backend's `openapi.yaml` doesn't include file upload/download endpoints. When those land, add a `tests/files.test.ts` following the same pattern.

## Conventions

- **One file per resource.** Matches Stripe, Anthropic, OpenAI, and most other OSS SDK test layouts. Easy to scan, easy to `vitest run tests/sandboxes.test.ts` a single file when debugging.
- **Shared sandbox per suite.** Tests inside `sandboxes.test.ts` or `exec.test.ts` reuse the same sandbox via `beforeAll`. Minimizes API calls and matches how real consumers use the SDK (create once, do many things).
- **Polling over sleeping.** Never `setTimeout`-and-hope. `waitForStatus()` polls `getSandbox` until the expected status is observed or the timeout elapses with a clear error message.
- **Cleanup is non-fatal.** If `afterAll` cleanup fails, the error is logged but doesn't mask the real test failure. Orphans are identifiable by their `sdk-e2e-*-${RUN_ID}` prefix.
- **Serial test file execution.** `vitest.config.ts` sets `sequence.concurrent: false` so two files don't race on resource quotas in the target environment.
- **Generous timeouts.** 60s per test, 120s per hook. Lifecycle operations like `pauseSandbox` transitions can legitimately take 30–60s.

## Why this is separate from the CI test pipeline

1. **Credentials.** Running on every PR would require a CI secret, generate load on staging, and cost money.
2. **Speed.** A full suite run is ~30–90 seconds depending on sandbox start times. The regular `test` task is sub-second.
3. **Flakiness domain.** E2E failures can indicate backend issues, network issues, quota issues — not SDK bugs. Mixing them with unit tests muddies the signal.

### Recommended CI integration (not included by default)

When you want scheduled e2e coverage, add `.github/workflows/sdk-e2e.yml`:

```yaml
name: SDK E2E (staging)

on:
  schedule:
    - cron: "0 6 * * *" # daily at 06:00 UTC
  workflow_dispatch: # manual trigger

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.5
      - run: bun install --frozen-lockfile
      - run: bun run test:e2e
        env:
          SUPERSERVE_API_KEY: ${{ secrets.SUPERSERVE_STAGING_API_KEY }}
          SUPERSERVE_BASE_URL: https://api-staging.superserve.ai
```
