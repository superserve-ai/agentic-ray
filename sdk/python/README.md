# Superserve Python SDK

Official Python SDK for [Superserve](https://superserve.ai) hosted agents.

[![Python Version](https://img.shields.io/pypi/pyversions/superserve-sdk)](https://pypi.org/project/superserve-sdk/)
[![License](https://img.shields.io/github/license/superserve-ai/superserve-sdk-python)](LICENSE)

## Features

- **Async-First Design**: Built on `httpx` for high-performance async HTTP
- **Type Safety**: Full type hints and Pydantic models
- **Streaming Support**: Real-time SSE streaming for agent responses
- **Sync Wrapper**: Synchronous API for simpler use cases
- **Metrics Collection**: Built-in tracking for tokens, tool calls, and performance

## Documentation

Full documentation is available in the [docs/](docs/) directory:

- [Getting Started](docs/index.md) - Overview and quick start guide
- [Authentication](docs/authentication.md) - API key setup and credentials
- [Agents](docs/agents.md) - Agent creation and management
- [Runs](docs/runs.md) - Running agents and streaming responses
- [Events](docs/events.md) - SSE event types reference
- [Metrics](docs/metrics.md) - Token usage and performance tracking
- [Errors](docs/errors.md) - Error handling and exception types
- [Examples](docs/examples.md) - Complete code examples

## Installation

```bash
pip install superserve-sdk
```

Or with [uv](https://github.com/astral-sh/uv):

```bash
uv add superserve-sdk
```

## Quick Start

### Authentication

Set your API key as an environment variable:

```bash
export SUPERSERVE_API_KEY=your-api-key
```

Or pass it directly to the client:

```python
from superserve_sdk import Superserve

client = Superserve(api_key="your-api-key")
```

Or save it to `~/.superserve/credentials.json`:

```json
{"api_key": "your-api-key"}
```

### Basic Usage (Async)

```python
import asyncio
from superserve_sdk import Superserve

async def main():
    async with Superserve() as client:
        # Create an agent
        agent = await client.create_agent(
            name="my-assistant",
            model="claude-sonnet-4-20250514",
            system_prompt="You are a helpful assistant.",
            tools=["Bash", "Read", "Write"],
        )
        print(f"Created agent: {agent.id}")

        # Run the agent and wait for completion
        run = await client.run(agent.id, "What is 2 + 2?")
        print(f"Output: {run.output}")

        # List all agents
        agents = await client.list_agents()
        for a in agents:
            print(f"  - {a.name} ({a.id})")

        # Delete the agent
        await client.delete_agent(agent.id)

asyncio.run(main())
```

### Basic Usage (Sync)

```python
from superserve_sdk import SuperserveSync

with SuperserveSync() as client:
    # Create an agent
    agent = client.create_agent(
        name="my-assistant",
        model="claude-sonnet-4-20250514",
    )

    # Run the agent
    run = client.run(agent.id, "What files are in the current directory?")
    print(run.output)

    # Clean up
    client.delete_agent(agent.id)
```

### Streaming Responses

Stream events as they arrive for real-time output:

```python
import asyncio
from superserve_sdk import Superserve, MessageDeltaEvent, ToolStartEvent, ToolEndEvent

async def main():
    async with Superserve() as client:
        async for event in client.stream("my-assistant", "Analyze this codebase"):
            if isinstance(event, MessageDeltaEvent):
                # Print text as it streams
                print(event.content, end="", flush=True)
            elif isinstance(event, ToolStartEvent):
                print(f"\n[Using {event.tool}...]", end="")
            elif isinstance(event, ToolEndEvent):
                print(f" done ({event.duration_ms}ms)")

asyncio.run(main())
```

### Streaming with Metrics

Collect metrics while streaming:

```python
import asyncio
from superserve_sdk import Superserve, MessageDeltaEvent

async def main():
    async with Superserve() as client:
        events, metrics_handle = await client.stream_with_metrics(
            "my-assistant",
            "Write a Python function to calculate fibonacci numbers",
        )

        async for event in events:
            if isinstance(event, MessageDeltaEvent):
                print(event.content, end="", flush=True)

        # Access metrics after streaming
        metrics = metrics_handle.metrics
        print(f"\n\nMetrics:")
        print(f"  Total tokens: {metrics.total_tokens}")
        print(f"  Duration: {metrics.duration_ms}ms")
        print(f"  Tool calls: {metrics.tool_call_count}")

asyncio.run(main())
```

### Managing Agents

```python
import asyncio
from superserve_sdk import Superserve

async def main():
    async with Superserve() as client:
        # Create an agent
        agent = await client.create_agent(
            name="code-reviewer",
            model="claude-sonnet-4-20250514",
            system_prompt="You are an expert code reviewer.",
            tools=["Read", "Glob", "Grep"],
            max_turns=20,
            timeout_seconds=600,
        )

        # Get agent by name or ID
        agent = await client.get_agent("code-reviewer")
        agent = await client.get_agent("agt_abc123...")

        # Update agent configuration
        agent = await client.update_agent(
            "code-reviewer",
            system_prompt="You are a senior code reviewer with security expertise.",
            max_turns=30,
        )

        # List all agents
        agents = await client.list_agents()

        # Delete agent
        await client.delete_agent("code-reviewer")

asyncio.run(main())
```

### Managing Runs

```python
import asyncio
from superserve_sdk import Superserve

async def main():
    async with Superserve() as client:
        # Start a run without waiting
        run = await client.run(
            "my-assistant",
            "Analyze this large codebase",
            wait=False,
        )
        print(f"Run started: {run.id}")

        # Check run status
        run = await client.get_run(run.id)
        print(f"Status: {run.status}")

        # List runs for an agent
        runs = await client.list_runs(agent_id="my-assistant", limit=10)

        # List runs by status
        running = await client.list_runs(status="running")
        completed = await client.list_runs(status="completed")

        # Cancel a run
        if run.status in ("pending", "running"):
            run = await client.cancel_run(run.id)
            print(f"Run cancelled: {run.status}")

asyncio.run(main())
```

### Multi-turn Conversations

Use session IDs for multi-turn conversations:

```python
import asyncio
from superserve_sdk import Superserve

async def main():
    async with Superserve() as client:
        session_id = "user-123-session-1"

        # First turn
        run1 = await client.run(
            "my-assistant",
            "My name is Alice.",
            session_id=session_id,
        )

        # Second turn (agent remembers context)
        run2 = await client.run(
            "my-assistant",
            "What is my name?",
            session_id=session_id,
        )
        print(run2.output)  # Should mention "Alice"

asyncio.run(main())
```

## Event Types

The SDK provides typed event classes for streaming:

| Event Type | Description |
|------------|-------------|
| `RunStartedEvent` | Run has started executing |
| `MessageDeltaEvent` | Text content chunk from the agent |
| `ToolStartEvent` | Tool execution started |
| `ToolEndEvent` | Tool execution completed |
| `RunCompletedEvent` | Run completed successfully |
| `RunFailedEvent` | Run failed with an error |
| `RunCancelledEvent` | Run was cancelled |

## Error Handling

```python
from superserve_sdk import (
    Superserve,
    SuperserveError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
    RateLimitError,
)

async def main():
    try:
        async with Superserve() as client:
            agent = await client.get_agent("nonexistent")
    except AuthenticationError:
        print("Invalid API key")
    except NotFoundError as e:
        print(f"Agent not found: {e.resource_id}")
    except ValidationError as e:
        print(f"Invalid request: {e.message}")
    except RateLimitError as e:
        print(f"Rate limited. Retry after {e.retry_after}s")
    except SuperserveError as e:
        print(f"API error: {e.message}")
```

## Configuration

### Custom Base URL

```python
client = Superserve(
    base_url="https://api.custom-superserve.com",
)
```

### Custom Timeout

```python
client = Superserve(
    timeout=60.0,  # 60 second timeout
)
```

### Credentials File

The SDK can read credentials from `~/.superserve/credentials.json`:

```json
{
  "api_key": "your-api-key"
}
```

## API Reference

### Superserve (Async Client)

#### Agent Methods

- `create_agent(name, model, system_prompt, tools, max_turns, timeout_seconds)` - Create a new agent
- `list_agents(limit, offset)` - List all agents
- `get_agent(agent_id)` - Get an agent by ID or name
- `update_agent(agent_id, ...)` - Update agent configuration
- `delete_agent(agent_id)` - Delete an agent

#### Run Methods

- `run(agent_id, prompt, session_id, wait, poll_interval)` - Run an agent
- `stream(agent_id, prompt, session_id)` - Stream run events
- `stream_with_metrics(agent_id, prompt, session_id)` - Stream with metrics collection
- `get_run(run_id)` - Get a run by ID
- `list_runs(agent_id, status, limit, offset)` - List runs
- `cancel_run(run_id)` - Cancel a running run

### SuperserveSync (Sync Client)

Same methods as `Superserve`, but synchronous (blocking).

## License

MIT
