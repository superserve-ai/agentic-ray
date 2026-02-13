"""Superserve Python SDK for hosted agents.

This SDK provides a client for interacting with Superserve hosted agents,
including creating agents, running prompts, and streaming responses.

Basic Usage:
    ```python
    from superserve_sdk import Superserve

    # Async usage
    async with Superserve() as client:
        agent = await client.create_agent(name="my-agent")
        run = await client.run(agent.id, "Hello, world!")
        print(run.output)

    # Sync usage
    from superserve_sdk import SuperserveSync

    with SuperserveSync() as client:
        agent = client.create_agent(name="my-agent")
        run = client.run(agent.id, "Hello, world!")
        print(run.output)
    ```

Streaming:
    ```python
    from superserve_sdk import Superserve, MessageDeltaEvent

    async with Superserve() as client:
        async for event in client.stream("my-agent", "Hello"):
            if isinstance(event, MessageDeltaEvent):
                print(event.content, end="", flush=True)
    ```
"""

from ._sync import SuperserveSync
from .auth import (
    AuthProvider,
    Credentials,
    clear_credentials,
    get_api_key,
    load_credentials_from_file,
    save_credentials_to_file,
)
from .client import Superserve
from .events import (
    BaseEvent,
    MessageDeltaEvent,
    RawEvent,
    RunCancelledEvent,
    RunCompletedEvent,
    RunEvent,
    RunFailedEvent,
    RunStartedEvent,
    ToolEndEvent,
    ToolStartEvent,
    parse_event,
)
from .exceptions import (
    APIError,
    AuthenticationError,
    ConflictError,
    ConnectionError,
    NotFoundError,
    RateLimitError,
    StreamError,
    SuperserveError,
    TimeoutError,
    ValidationError,
)
from .metrics import MetricsCollector, RunMetrics, ToolMetrics
from .models import (
    Agent,
    AgentConfig,
    AgentUpdateConfig,
    Run,
    RunCreateRequest,
    UsageMetrics,
)

__version__ = "0.1.0"

__all__ = [
    # Version
    "__version__",
    # Main clients
    "Superserve",
    "SuperserveSync",
    # Models
    "Agent",
    "AgentConfig",
    "AgentUpdateConfig",
    "Run",
    "RunCreateRequest",
    "UsageMetrics",
    # Events
    "BaseEvent",
    "RunEvent",
    "RunStartedEvent",
    "MessageDeltaEvent",
    "ToolStartEvent",
    "ToolEndEvent",
    "RunCompletedEvent",
    "RunFailedEvent",
    "RunCancelledEvent",
    "RawEvent",
    "parse_event",
    # Metrics
    "MetricsCollector",
    "RunMetrics",
    "ToolMetrics",
    # Auth
    "AuthProvider",
    "Credentials",
    "get_api_key",
    "load_credentials_from_file",
    "save_credentials_to_file",
    "clear_credentials",
    # Exceptions
    "SuperserveError",
    "APIError",
    "AuthenticationError",
    "NotFoundError",
    "ValidationError",
    "ConflictError",
    "RateLimitError",
    "StreamError",
    "ConnectionError",
    "TimeoutError",
]
