# Parallel Benchmark Agent

A Claude Managed Agent that benchmarks code across multiple configurations simultaneously. The agent writes a parallel harness that spins up N isolated Superserve sandboxes — one per variant — runs them all concurrently, collects timing results, and synthesizes a comparison report.

**The core pitch:** Benchmarking 9 configurations sequentially takes 9× longer than benchmarking them in parallel. Superserve sandboxes boot in under 50ms and run truly isolated. The agent drives all of this autonomously.

This is the **technical showpiece** recipe — it demonstrates hierarchical sandbox usage (an agent that creates sandboxes) and Superserve's architecture most clearly.

## How it works

```
User: "Benchmark bubble sort, quicksort, and Python's built-in sort
       on 10k, 100k, and 1M random integers. 3 trials each."

Agent reasoning:
  → 3 algorithms × 3 sizes = 9 variants
  → writes /workspace/benchmark.py (harness + sort implementations)
  → writes /workspace/run_parallel.py (creates 9 sandboxes via asyncio.gather)
  → runs: SUPERSERVE_API_KEY=$SUPERSERVE_API_KEY python3 /workspace/run_parallel.py

run_parallel.py (agent-authored):
  → asyncio.gather(create sandbox × 9)     ← 9 sandboxes boot in ~1s each
  → asyncio.gather(upload + run × 9)       ← all 9 run simultaneously
  → asyncio.gather(collect results × 9)
  → asyncio.gather(kill × 9)
  → writes /workspace/results.md

Agent reads results.md, synthesizes:
  → "Python's built-in sort (Timsort) is 40× faster than bubble sort
     at 1M elements. Quicksort is 15× faster. Here's the full table..."
```

Total time for 9 variants: ~35 seconds (dominated by the slowest benchmark run, not the sum).

The agent-authored harness looks like this:

```python
# Agent writes this to /workspace/run_parallel.py
import asyncio, os
from superserve import AsyncSandbox

VARIANTS = [
    ("bubble_sort",  10_000), ("bubble_sort",  100_000), ("bubble_sort",  1_000_000),
    ("quicksort",    10_000), ("quicksort",    100_000), ("quicksort",    1_000_000),
    ("builtin_sort", 10_000), ("builtin_sort", 100_000), ("builtin_sort", 1_000_000),
]

async def run_variant(algo, size):
    sandbox = await AsyncSandbox.create(name=f"bench-{algo}-{size}")
    await sandbox.files.write("/bench.py", open("/workspace/benchmark.py").read())
    result = await sandbox.commands.run(f"python3 /bench.py {algo} {size}")
    await sandbox.kill()
    return {"algo": algo, "size": size, "output": result.stdout}

results = asyncio.run(asyncio.gather(*[run_variant(a, s) for a, s in VARIANTS]))
# write results.md ...
```

## Prerequisites

- A [Superserve account](https://console.superserve.ai) and API key
- An [Anthropic account](https://platform.claude.com) with Claude Managed Agents access
- A self-hosted environment created via the [Claude Platform Console](https://platform.claude.com/workspaces/default/environments)
- Python 3.12+ or Node.js 22+

## Quick start

### Python

```bash
cd python
uv sync
cp .env.example .env  # fill in your API keys
```

| Script                   | What it does                                                                     |
| ------------------------ | -------------------------------------------------------------------------------- |
| `build_template.py`      | Builds the `claude-benchmark-agent` template (includes `superserve` pip package) |
| `create_agent.py <name>` | Creates an agent with `bash`, `read`, `write`                                    |
| `orchestrator.py`        | Polls the work queue, creates/resumes sandboxes, starts runners                  |

```bash
uv run build_template.py         # one-time
uv run create_agent.py my-agent  # one-time
uv run orchestrator.py           # long-running
```

### TypeScript

```bash
cd typescript
npm install
cp .env.example .env  # fill in your API keys
```

| Script                    | What it does                                                                     |
| ------------------------- | -------------------------------------------------------------------------------- |
| `build-template.mjs`      | Builds the `claude-benchmark-agent` template (includes `superserve` pip package) |
| `create-agent.mjs <name>` | Creates an agent with `bash`, `read`, `write`                                    |
| `orchestrator.mjs`        | Polls the work queue, creates/resumes sandboxes, starts runners                  |

```bash
node build-template.mjs         # one-time
node create-agent.mjs my-agent  # one-time
node orchestrator.mjs           # long-running
```

## Key differences from the base recipe

- **Template:** `claude-benchmark-agent` — installs `superserve` Python SDK (the agent uses it to create sub-sandboxes)
- **Tools:** `bash`, `read`, `write` (no web tools — benchmarks are self-contained)
- **Network:** `api.anthropic.com` + `api.superserve.ai` (the agent calls the Superserve API from inside its sandbox)
- **`SUPERSERVE_API_KEY`:** Passed as an environment variable to the runner — the agent uses it to authenticate when creating sub-sandboxes

## Sub-sandbox billing

Sub-sandboxes accrue charges while running. The agent-written harness always kills them immediately after collecting results. A typical benchmark run: 9 sandboxes × 30 seconds each = 4.5 sandbox-minutes. The harness guarantees cleanup even on error.

## See also

- [Full guide](https://docs.superserve.ai/integrations/managed-agents/claude-managed-agents)
- [Base recipe](../../) — simpler starting point without sub-sandbox creation
- [Claude Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)
