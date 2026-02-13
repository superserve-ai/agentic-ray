<div align="center">
  <a href="https://superserve.ai/"><img width="1185" height="395" alt="Superserve" src="https://raw.githubusercontent.com/superserve-ai/agentic-ray/main/assets/superserve-logo-light-transparent.svg" /></a>

  <p><strong>Scalable runtime for Agents, MCP Servers, and coding sandboxes, orchestrated with Ray.</strong></p>

  <!-- [![PyPI version](https://img.shields.io/pypi/v/agentic-ray.svg)](https://pypi.org/project/agentic-ray/) -->
  [![Docs](https://img.shields.io/badge/Docs-latest-blue)](https://docs.superserve.ai/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/superserve-ai/agentic-ray/blob/main/LICENSE)
  [![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://python.org)
  [![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord&logoColor=white)](https://discord.gg/utftfhSK)
  [![Slack](https://img.shields.io/badge/Slack-Join%20Us-4A154B?logo=slack&logoColor=white)](https://superserve.ai/join-slack)

</div>

## Features

- **Distributed Runtime** - Resource-aware tool execution on Ray clusters with automatic scaling
- **Framework Agnostic** - Works with LangChain, Pydantic AI, Agno, or pure Python
- **Secure Sandboxing** - gVisor-sandboxed environments for AI-generated code execution
- **Simple CLI** - Initialize projects, create agents, and serve with single commands
- **Production Ready** - Built on Ray Serve for reliable, scalable deployments

## Quick Start

```bash
# Install
pip install superserve

# Create a new project
superserve init my_project
cd my_project

# Create your first agent
superserve create-agent my_agent --framework pydantic

# Run locally
superserve up
```

Your agent is now available at `http://localhost:8000/agents/my_agent/`

## Installation

```bash
pip install superserve
```

With optional sandbox support (for code execution):

```bash
pip install superserve[sandbox]
```

**Requirements:** Python 3.12+

## Usage

### CLI Commands

#### Initialize a Project

```bash
superserve init my_project
```

Creates a project structure with configuration files and an `agents/` directory.

#### Create an Agent

```bash
superserve create-agent my-agent
superserve create-agent my-agent --framework langchain
superserve create-agent my-agent --framework pydantic
```

Supported frameworks: `python` (default), `langchain`, `pydantic`

#### Run Agents

```bash
superserve up                             # Run all agents on port 8000
superserve up --port 9000                 # Custom port
superserve up --agents agent1,agent2      # Run specific agents
```


## Creating Your First Agent

After running `superserve create-agent my_agent --framework pydantic`, edit `agents/my_agent/agent.py`:

```python
import superserve
from pydantic_ai import Agent

@superserve.tool(num_cpus=1)
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

# Create Pydantic AI agent with Ray-distributed tools
def make_agent():
    return Agent(
        "openai:gpt-4o-mini",
        system_prompt="You are a helpful assistant.",
        tools=[search],
    )

# Serve the agent
superserve.serve(make_agent, name="my_agent", num_cpus=1, memory="2GB")
```

Run with:
```bash
superserve up
```

Test your agent:

```bash
curl -X POST http://localhost:8000/agents/my_agent/ \
  -H "Content-Type: application/json" \
  -d '{"query": "Hello!"}'
```

## API Reference

### `@superserve.tool` Decorator

Creates a Ray-distributed async tool from a function. Works as both a decorator and wrapper for framework tools.

```python
import superserve

# As decorator (uses defaults: num_cpus=1, num_gpus=0)
@superserve.tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

# As decorator with explicit resources
@superserve.tool(num_cpus=2, memory="4GB")
def expensive_task(data: str) -> str:
    return process(data)

# As wrapper for framework tools
from langchain_community.tools import DuckDuckGoSearchRun
lc_search = superserve.tool(DuckDuckGoSearchRun())
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `num_cpus` | int/float | 1 | CPU cores per invocation |
| `num_gpus` | int/float | 0 | GPUs per invocation |
| `memory` | str | None | Memory requirement (e.g., "1GB") |

### `superserve.serve()`

Serve an agent via HTTP with Ray Serve. Auto-detects framework (Pydantic AI, LangChain, custom).

```python
import superserve
from pydantic_ai import Agent

def make_agent():
    return Agent("openai:gpt-4", tools=[search])

superserve.serve(make_agent, name="myagent", num_cpus=1, memory="2GB")
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agent` | Any | required | Agent class, function, or instance |
| `name` | str | None | Agent name (inferred from directory if not set) |
| `port` | int | 8000 | HTTP port |
| `num_cpus` | int | 1 | CPU cores per replica |
| `num_gpus` | int | 0 | GPUs per replica |
| `memory` | str | "2GB" | Memory allocation |
| `replicas` | int | 1 | Number of replicas |

### `superserve.Agent` Base Class

For custom agents without a framework:

```python
from superserve import Agent

class MyAgent(Agent):
    tools = [search, analyze]

    async def run(self, query: str) -> str:
        result = await self.call_tool("search", query=query)
        return f"Found: {result}"

superserve.serve(MyAgent, name="myagent")
```

### `execute_tools`

Execute multiple tools in parallel on Ray:

```python
import superserve
from superserve import execute_tools

@superserve.tool(num_cpus=1)
def tool_1(x: str) -> str:
    """Process input with tool 1."""
    return process_1(x)

@superserve.tool(num_cpus=1)
def tool_2(x: str) -> dict:
    """Process input with tool 2."""
    return process_2(x)

# Execute both tools in parallel on Ray
results = execute_tools([
    (tool_1, {"x": "input_1"}),
    (tool_2, {"x": "input_2"})
], parallel=True)
```

## Examples

See the [examples/](https://github.com/superserve-ai/agentic-ray/tree/main/examples) directory for complete implementations:

- **Token-Efficient Agent** - Autonomous code execution in sandboxed environments
- **Finance Agent** - Multi-step financial analysis with external APIs


## Telemetry

Superserve collects anonymous usage data to help improve the CLI:
- Commands run (init, create-agent, up)
- Framework choices (python, langchain, pydantic)

No PII data, project information, or code is collected by telemetry without your explicit approval.

To opt out:
```bash
superserve analytics off
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/superserve-ai/agentic-ray/blob/main/CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](https://github.com/superserve-ai/agentic-ray/blob/main/LICENSE) file for details.

---

If you find this project helpful, please consider giving it a star!
