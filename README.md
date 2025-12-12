<div align="center">
  <img src="assets/rayai-logo-full-color.svg" alt="RayAI Logo" width="280"/>

  <p><strong>Scalable runtime for Agents, MCP Servers, and coding sandboxes, orchestrated with Ray.</strong></p>

  [![PyPI version](https://img.shields.io/pypi/v/agentic-ray.svg)](https://pypi.org/project/agentic-ray/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
  [![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://python.org)
  [![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord&logoColor=white)](#)
  [![Slack](https://img.shields.io/badge/Slack-Join%20Us-4A154B?logo=slack&logoColor=white)](#)

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
pip install agentic-ray

# Create a new project
rayai init my-agents
cd my-agents

# Create your first agent
rayai create-agent chatbot

# Run locally
rayai serve
```

Your agent is now available at `http://localhost:8000/agents/chatbot/chat`

## Installation

```bash
pip install agentic-ray
```

With optional code interpreter support:

```bash
pip install agentic-ray[code-interpreter]
```

**Requirements:** Python 3.12+

## Usage

### CLI Commands

#### Initialize a Project

```bash
rayai init my-project
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

### Resource Configuration

Configure resources per agent at runtime:

```bash
rayai serve --chatbot-num-cpus=4 --chatbot-memory=8GB --chatbot-num-replicas=2
```

## Creating Your First Agent

After running `rayai create-agent chatbot`, edit `agents/chatbot/agent.py`:

```python
from ray_agents import agent, tool

@tool(desc="Search for information", num_cpus=1)
def search(query: str) -> str:
    return f"Results for: {query}"

@agent(num_cpus=1, memory="2GB")
class ChatBot:
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
curl -X POST http://localhost:8000/agents/chatbot/chat \
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

Execute multiple tools in parallel or sequentially.

```python
from ray_agents import execute_tools

results = execute_tools([
    (search, {"query": "Python"}),
    (analyze, {"text": "Hello"})
], parallel=True)
```

## Examples

See the [examples/](examples/) directory for complete implementations:

- **Token-Efficient Agent** - Autonomous code execution in sandboxed environments
- **Finance Agent** - Multi-step financial analysis with external APIs

## GitHub Topics

To improve discoverability, add these topics to your fork: `ray`, `agents`, `llm`, `ai`, `distributed-computing`, `mcp`, `langchain`, `python`, `ai-agents`

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
