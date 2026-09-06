# Cursor Self-Hosted Machines on Superserve

Run [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent) on [Superserve sandboxes](https://superserve.ai) — a Self-Hosted Machines team pool where every request gets its own isolated Superserve sandbox, booted from a template with the Cursor CLI preinstalled.

Self-Hosted Machines is for teams that need to own the execution environment: a custom image, egress rules, a private registry, or an audit trail of what an agent reached. Superserve gives you that control without a worker fleet — each sandbox exists only for the length of a request, boots from your template, follows your network rules, and can be paused between turns instead of deleted.

Cursor runs the agent loop. Superserve runs the worker. A spawn hook and a monitor wire them together.

## How it fits together

- [**Cursor Cloud Agents**](https://cursor.com/docs/cloud-agent/self-hosted) — Cursor's background agents. With Self-Hosted Machines, the agent loop and model calls stay with Cursor while the checkout, edits, and shell commands run on a worker you provide.
- [**`agent worker controller`**](https://cursor.com/docs/cloud-agent/self-hosted/pool#worker-controller) — Cursor's built-in controller. It claims pending pool requests and runs a spawn hook once per claim.
- [**Superserve**](https://docs.superserve.ai) — isolated sandboxes. Each worker gets its own sandbox with a full filesystem, shell, and network namespace. Sandboxes boot in under 50ms and can be paused between turns.

The spawn hook creates a sandbox per claim and starts `agent worker` inside it under the worker id Cursor assigned. The monitor deletes the sandbox when the worker exits, or pauses it when hibernation is on so a follow-up resumes on the same workspace.

## Code at a glance

Build a template once — every worker boots from it:

```typescript
import { Template } from "@superserve/sdk"

const template = await Template.create({
  name: "cursor-worker",
  from: "ubuntu:24.04",
  vcpu: 2,
  memoryMib: 2048,
  diskMib: 8192,
  steps: [
    {
      run: "apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git jq procps unzip && rm -rf /var/lib/apt/lists/*",
    },
    { run: "curl -fsS https://cursor.com/install | HOME=/root bash" },
    {
      run: "ln -sf /root/.local/bin/agent /usr/local/bin/agent && agent --version",
    },
    { run: "mkdir -p /workspace /var/lib/cursor-worker" },
    { workdir: "/workspace" },
  ],
})
await template.waitUntilReady()
```

The spawn hook creates a sandbox for the claim and launches the worker:

```typescript
const sandbox = await Sandbox.create({
  name: `cursor-${workerId.slice(0, 12)}`,
  fromTemplate: "cursor-worker",
  metadata: {
    "cursor.managed": "true",
    "cursor.worker_id": workerId,
    "cursor.pool": pool,
  },
  autoDeleteSeconds: 86_400, // reap if left paused for a day
})

// launch.sh detaches and runs:  agent worker --pool <pool> --clone-git-repos start
await sandbox.commands.run("bash /var/lib/cursor-worker/launch.sh", {
  env: {
    CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    CURSOR_AGENT_WORKER_ID: workerId,
    CURSOR_WORKER_IDLE_RELEASE_TIMEOUT: "600",
  },
})
```

`CURSOR_API_KEY` is passed on the launch command, so only the worker's process tree can read it. `SUPERSERVE_API_KEY` never enters the sandbox.

See the [full guide](https://docs.superserve.ai/integrations/managed-agents/cursor-cloud-agents) for the Cursor admin setup, egress rules, and hibernation.

## Prerequisites

- A [Superserve account](https://console.superserve.ai) and API key
- A Cursor Enterprise plan with Self-Hosted Machines and GitHub token minting enabled by a team admin
- A Cursor **service-account** API key — the only key type that can start pool workers
- The Cursor CLI on the controller host, plus Node.js 22+ or Python 3.12+

## Quick start

Both TypeScript and Python implementations are included.

### TypeScript

```bash
cd typescript
npm install
cp .env.example .env  # add SUPERSERVE_API_KEY and CURSOR_API_KEY
```

| Script               | What it does                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `build-template.mjs` | Builds the `cursor-worker` template (Ubuntu 24.04 + Cursor CLI)       |
| `spawn.mjs`          | `--spawn` hook: creates a sandbox and starts the worker in it         |
| `monitor.mjs`        | Deletes or pauses sandboxes whose worker exited; wakes them on demand |

```bash
node build-template.mjs   # one-time

# terminal 1: the controller (a Cursor binary, so export .env for it)
set -a && . ./.env && set +a
agent worker controller --spawn "$(pwd)/spawn.mjs" --pool superserve

# terminal 2: the monitor
node monitor.mjs
```

### Python

```bash
cd python
uv venv && uv pip install -e .
cp .env.example .env  # add SUPERSERVE_API_KEY and CURSOR_API_KEY
```

| Script              | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `build_template.py` | Builds the `cursor-worker` template (Ubuntu 24.04 + Cursor CLI)       |
| `spawn.sh`          | `--spawn` hook wrapper around `spawn.py`                              |
| `monitor.py`        | Deletes or pauses sandboxes whose worker exited; wakes them on demand |

```bash
.venv/bin/python build_template.py   # one-time

# terminal 1: the controller (a Cursor binary, so export .env for it)
set -a && . ./.env && set +a
agent worker controller --spawn "$(pwd)/spawn.sh" --pool superserve

# terminal 2: the monitor
.venv/bin/python monitor.py
```

Then create a Cloud Agent in Cursor and select the `superserve` pool. The sandbox appears in the console as `cursor-<worker id>`; its worker log is at `/var/lib/cursor-worker/worker.log`.

## Configuration

The scripts read these from `.env`:

| Setting                              | Default           | What it controls                                                                                        |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `SUPERSERVE_API_KEY`                 | required          | Sandbox creation, resume, and deletion                                                                  |
| `CURSOR_API_KEY`                     | required          | Service-account key for the controller, handed to each worker                                           |
| `CURSOR_POOL`                        | set by controller | Pool name. The monitor reads it from `.env` to scope its sweeps and wake-ups to that pool               |
| `CURSOR_WORKER_TEMPLATE`             | `cursor-worker`   | Template each sandbox boots from                                                                        |
| `CURSOR_WORKER_IDLE_RELEASE_TIMEOUT` | `600`             | Seconds a worker waits for follow-ups before exiting                                                    |
| `CURSOR_WORKER_CLONE_GIT_REPOS`      | `true`            | Start the worker with `--clone-git-repos`. Turn off for any-repo workers that handle their own checkout |
| `CURSOR_WORKER_HIBERNATE`            | `false`           | Pause sandboxes on worker exit instead of deleting them                                                 |
| `SANDBOX_AUTO_DELETE_SECONDS`        | `86400`           | How long a sandbox may stay paused before it is deleted                                                 |
| `CURSOR_WORKER_ALLOW_OUT`            | unset             | Comma-separated egress allowlist. Unset keeps the open default                                          |
| `MONITOR_POLL_SECONDS`               | `15`              | Monitor sweep interval                                                                                  |
| `MONITOR_GRACE_SECONDS`              | `120`             | Minimum sandbox age before the monitor may recycle it                                                   |

The controller sets `CURSOR_AGENT_WORKER_ID`, `CURSOR_REQUEST_ID`, and `CURSOR_WORKER_NAME` on each spawn. Leave them out of `.env`.

## See also

- [Full integration guide](https://docs.superserve.ai/integrations/managed-agents/cursor-cloud-agents)
- [Cursor Team Pools](https://cursor.com/docs/cloud-agent/self-hosted/pool)
- [Cursor Workers and Pools API](https://cursor.com/docs/cloud-agent/api/endpoints#workers-and-pools)
- [Superserve SDK reference](https://docs.superserve.ai/sdk-reference/sandbox)
