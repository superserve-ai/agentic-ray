<div align="center">
  <a href="https://rayai.com/"><img src="https://raw.githubusercontent.com/rayai-labs/agentic-ray/main/assets/rayai-logo-full-color.svg" alt="RayAI Logo" width="280"/></a>

  <p><strong>Scalable runtime for Agents, MCP Servers, and coding sandboxes, orchestrated with Ray.</strong></p>

  <!-- [![PyPI version](https://img.shields.io/pypi/v/agentic-ray.svg)](https://pypi.org/project/agentic-ray/) -->
  [![Docs](https://img.shields.io/badge/Docs-latest-blue)](https://docs.rayai.com/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/rayai-labs/agentic-ray/blob/main/LICENSE)
  [![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://python.org)
  [![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord&logoColor=white)](https://discord.gg/utftfhSK)
  [![Slack](https://img.shields.io/badge/Slack-Join%20Us-4A154B?logo=slack&logoColor=white)](https://rayai.com/join-slack)

</div>

## Features

- **Distributed Runtime** - Resource-aware tool execution on Ray clusters with automatic scaling
- **Framework Agnostic** - Works with LangChain, Pydantic AI, or pure Python (support for more frameworks coming soon)
- **Secure Sandboxing** - gVisor-sandboxed environments for AI-generated code execution
- **Simple CLI** - Initialize projects, create agents, and serve with single commands
- **Production Ready** - Built on Ray Serve for reliable, scalable deployments

## Quick Start

```bash
# Install
pip install rayai

# Create a new project
rayai init my_project
cd my_project

# Create your first agent
rayai create-agent my_agent

# Run locally
rayai serve
```

Your agent is now available at `http://localhost:8000/agents/my_agent/chat`

## Installation

```bash
pip install rayai
```

With optional sandbox support (for code execution):

```bash
pip install rayai[sandbox]
```

**Requirements:** Python 3.12+

## Usage

### CLI Commands

#### Initialize a Project

```bash
rayai init my_project
```

Creates a project structure with configuration files and an `agents/` directory.

#### Create an Agent

```bash
rayai create-agent my-agent
rayai create-agent my-agent --framework langchain
rayai create-agent my-agent --framework pydantic
```

Supported frameworks: `python` (default), `langchain`, `pydantic`

#### Serve Agents

```bash
rayai serve                          # Serve all agents on port 8000
rayai serve --port 9000              # Custom port
rayai serve --agents agent1,agent2   # Serve specific agents
```


## Creating Your First Agent

After running `rayai create-agent my_agent`, edit `agents/my_agent/agent.py`:

```python
from rayai import agent, tool

@tool(desc="Search for information", num_cpus=1)
def search(query: str) -> str:
    return f"Results for: {query}"

@agent(num_cpus=1, memory="2GB")
class MyAgent:
    def __init__(self):
        self.tools = [search]

    def run(self, data: dict) -> dict:
        messages = data.get("messages", [])
        user_message = messages[-1]["content"] if messages else ""

        # Your agent logic here
        return {"response": f"You said: {user_message}"}
```

Test your agent:

```bash
curl -X POST http://localhost:8000/agents/my_agent/chat \
  -H "Content-Type: application/json" \
  -d '{"data": {"messages": [{"role": "user", "content": "Hello!"}]}, "session_id": "test"}'
```

## API Reference

### `@agent` Decorator

Marks a class as a deployable agent with resource requirements.

```python
@agent(num_cpus=2, memory="4GB", num_gpus=1, num_replicas=2)
class MyAgent:
    def run(self, data: dict) -> dict:
        return {"response": "Hello!"}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `num_cpus` | int | 1 | CPU cores per replica |
| `num_gpus` | int | 0 | GPUs per replica |
| `memory` | str | "2GB" | Memory allocation |
| `num_replicas` | int | 1 | Number of replicas |

### `@tool` Decorator

Creates a Ray remote task from a function.

```python
@tool(desc="Tool description", num_cpus=2, memory="1GB")
def my_tool(query: str) -> dict:
    return {"result": query}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `desc` | str | required | Tool description for LLM |
| `num_cpus` | int | 1 | CPU requirement |
| `num_gpus` | int | 0 | GPU requirement |
| `memory` | str | None | Memory requirement |

### `execute_tools`

Define tools and execute them in parallel on Ray:

```python
from rayai import tool, execute_tools

@tool(desc="Tool 1 description")
def tool_1(x: str) -> str:
    return process_1(x)

@tool(desc="Tool 2 description")
def tool_2(x: str) -> dict:
    return process_2(x)

# Execute both tools in parallel on Ray
results = execute_tools([
    (tool_1, {"x": "input_1"}),
    (tool_2, {"x": "input_2"})
], parallel=True)
```

## Examples

See the [examples/](https://github.com/rayai-labs/agentic-ray/tree/main/examples) directory for complete implementations:

- **Token-Efficient Agent** - Autonomous code execution in sandboxed environments
- **Finance Agent** - Multi-step financial analysis with external APIs


## Telemetry

RayAI collects anonymous usage data to help improve the CLI:
- Commands run (init, create-agent, serve)
- Framework choices (python, langchain, pydantic)

No PII data, project information, or code is collected by telemetry without your explicit approval.

To opt out:
```bash
rayai analytics off
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/rayai-labs/agentic-ray/blob/main/CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](https://github.com/rayai-labs/agentic-ray/blob/main/LICENSE) file for details.

---

If you find this project helpful, please consider giving it a ⭐
