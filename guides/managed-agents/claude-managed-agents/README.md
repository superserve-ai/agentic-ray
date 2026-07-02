# Claude Managed Agents on Superserve

Run [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) inside [Superserve sandboxes](https://superserve.ai) — isolated Firecracker microVMs with fast (<50ms) startup, pause/resume, and per-sandbox network isolation.

Anthropic runs the harness. Superserve runs the sandbox. You wire them together with an orchestrator.

## How it fits together

- [**Claude Managed Agents**](https://platform.claude.com/docs/en/managed-agents/overview) — Anthropic's remote agent harness. Orchestrates the agent loop, manages sessions, dispatches tool calls via a work queue.
- [**Superserve**](https://docs.superserve.ai) — Firecracker microVM sandboxes. Each session gets its own VM with a full filesystem, shell, and network namespace. Sandboxes boot in under 50ms and can be paused between turns.

The orchestrator polls Anthropic's work queue, creates (or resumes) a Superserve sandbox for each session, and starts a runner inside it. The runner executes tool calls — `bash`, `read`, `write`, `edit`, `glob`, `grep` — against the sandbox and posts results back.

## Code at a glance

Build a template once — every sandbox boots from it instantly:

```python
from superserve import Template, RunStep, WorkdirStep

template = Template.create(
    name="claude-managed-agent",
    from_="python:3.12-slim",
    vcpu=2,
    memory_mib=2048,
    steps=[
        RunStep(run="apt-get update && apt-get install -y curl git jq procps && rm -rf /var/lib/apt/lists/*"),
        RunStep(run="pip install --no-cache-dir anthropic"),
        RunStep(run="mkdir -p /workspace /mnt/session/outputs"),
        WorkdirStep(workdir="/workspace"),
    ],
)
template.wait_until_ready()
```

The orchestrator claims work and spins up sandboxes:

```python
from anthropic import AsyncAnthropic
from superserve import AsyncSandbox, NetworkConfig

async with AsyncAnthropic(auth_token=environment_key) as client:
    async for work in client.beta.environments.work.poller(
        environment_id=environment_id,
        environment_key=environment_key,
        auto_stop=False,
    ):
        sandbox = await AsyncSandbox.create(
            name=f"cma-{work.data.id[:8]}",
            from_template="claude-managed-agent",
            network=NetworkConfig(allow_out=["api.anthropic.com"]),
        )
        await sandbox.files.write("/workspace/runner.py", runner_code)
        await sandbox.commands.run(
            "nohup python3 /workspace/runner.py > /workspace/runner.log 2>&1 &",
            env={"ANTHROPIC_ENVIRONMENT_KEY": environment_key, ...},
        )
```

Inside the sandbox, the runner handles tool execution:

```python
from anthropic import AsyncAnthropic

async with AsyncAnthropic(auth_token=environment_key) as client:
    await client.beta.environments.work.worker(
        environment_key=environment_key,
        workdir="/workspace",
    ).handle_item()
```

See the [full guide](https://docs.superserve.ai/integrations/managed-agents/claude-managed-agents) for the complete walkthrough.

## Prerequisites

- A [Superserve account](https://console.superserve.ai) and API key
- An [Anthropic account](https://platform.claude.com) with Claude Managed Agents access
- Python 3.12+ or Node.js 22+

## Quick start

Both Python and TypeScript implementations are included.

### Python

```bash
cd python
uv sync
cp .env.example .env  # add your API keys
```

| Script                   | What it does                                                       |
| ------------------------ | ------------------------------------------------------------------ |
| `create_environment.py`  | Creates a self-hosted environment on Claude Platform               |
| `build_template.py`      | Builds the Superserve sandbox template with Python + Anthropic SDK |
| `create_agent.py <name>` | Creates an agent with bash, file, and web tools enabled            |
| `orchestrator.py`        | Polls the work queue, creates sandboxes, starts runners            |

```bash
uv run create_environment.py     # one-time
uv run build_template.py         # one-time
uv run create_agent.py my-agent  # one-time
uv run orchestrator.py           # long-running
```

### TypeScript

```bash
cd typescript
npm install
cp .env.example .env  # add your API keys
```

| Script                    | What it does                                            |
| ------------------------- | ------------------------------------------------------- |
| `create-environment.mjs`  | Creates a self-hosted environment on Claude Platform    |
| `build-template.mjs`      | Builds the Superserve sandbox template                  |
| `create-agent.mjs <name>` | Creates an agent with bash, file, and web tools enabled |
| `orchestrator.mjs`        | Polls the work queue, creates sandboxes, starts runners |

```bash
node create-environment.mjs     # one-time
node build-template.mjs         # one-time
node create-agent.mjs my-agent  # one-time
node orchestrator.mjs           # long-running
```

## See also

- [Full integration guide](https://docs.superserve.ai/integrations/managed-agents/claude-managed-agents)
- [Claude Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)
- [Superserve SDK reference](https://docs.superserve.ai/sdk-reference/sandbox)
