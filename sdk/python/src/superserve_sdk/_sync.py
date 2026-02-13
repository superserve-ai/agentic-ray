"""Synchronous wrapper for the Superserve client."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any, TypeVar

from .client import Superserve
from .constants import DEFAULT_MODEL
from .events import RunEvent
from .metrics import MetricsCollector, RunMetrics
from .models import Agent, Run

T = TypeVar("T")


def _run_sync(coro: Any) -> Any:
    """Run a coroutine synchronously.

    This handles the case where we may or may not already be in an event loop.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None:
        # We're in an async context, use nest_asyncio pattern
        import threading

        result: Any = None
        exception: Exception | None = None

        def run_in_thread() -> None:
            nonlocal result, exception
            try:
                new_loop = asyncio.new_event_loop()
                asyncio.set_event_loop(new_loop)
                try:
                    result = new_loop.run_until_complete(coro)
                finally:
                    new_loop.close()
            except Exception as e:
                exception = e

        thread = threading.Thread(target=run_in_thread)
        thread.start()
        thread.join()

        if exception is not None:
            raise exception
        return result
    else:
        return asyncio.run(coro)


class SuperserveSync:
    """Synchronous client for the Superserve API.

    This is a blocking wrapper around the async Superserve client.

    Example:
        ```python
        from superserve_sdk import SuperserveSync

        with SuperserveSync() as client:
            # Create an agent
            agent = client.create_agent(
                name="my-agent",
                model="claude-sonnet-4-5-20250929",
            )

            # Run the agent
            run = client.run(agent.id, "What is 2+2?")
            print(run.output)
        ```
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "https://api.superserve.ai",
        timeout: float = 30.0,
        credentials_path: Path | None = None,
    ) -> None:
        """Initialize the synchronous Superserve client.

        Args:
            api_key: API key for authentication. If not provided, will be read
                from SUPERSERVE_API_KEY env var or ~/.superserve/credentials.json.
            base_url: Base URL for the Superserve API.
            timeout: Default request timeout in seconds.
            credentials_path: Path to credentials file.
        """
        self._async_client = Superserve(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            credentials_path=credentials_path,
        )

    def __enter__(self) -> SuperserveSync:
        """Enter context manager."""
        _run_sync(self._async_client.__aenter__())
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Exit context manager."""
        _run_sync(self._async_client.__aexit__(exc_type, exc_val, exc_tb))

    def close(self) -> None:
        """Close the HTTP client."""
        _run_sync(self._async_client.close())

    # ==================== AGENTS ====================

    def create_agent(
        self,
        name: str,
        model: str = DEFAULT_MODEL,
        system_prompt: str = "You are a helpful assistant.",
        tools: list[str] | None = None,
        max_turns: int = 10,
        timeout_seconds: int = 300,
    ) -> Agent:
        """Create a new hosted agent.

        Args:
            name: Agent name (lowercase, alphanumeric with hyphens).
            model: Model to use (e.g., "claude-sonnet-4-5-20250929").
            system_prompt: System prompt for the agent.
            tools: List of tools the agent can use.
            max_turns: Maximum conversation turns.
            timeout_seconds: Timeout for agent runs.

        Returns:
            The created Agent.
        """
        return _run_sync(
            self._async_client.create_agent(
                name=name,
                model=model,
                system_prompt=system_prompt,
                tools=tools,
                max_turns=max_turns,
                timeout_seconds=timeout_seconds,
            )
        )

    def list_agents(
        self,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Agent]:
        """List all hosted agents.

        Args:
            limit: Maximum number of agents to return.
            offset: Number of agents to skip.

        Returns:
            List of agents.
        """
        return _run_sync(self._async_client.list_agents(limit=limit, offset=offset))

    def get_agent(self, agent_id: str) -> Agent:
        """Get an agent by ID or name.

        Args:
            agent_id: Agent ID (with or without agt_ prefix) or agent name.

        Returns:
            The agent.
        """
        return _run_sync(self._async_client.get_agent(agent_id))

    def update_agent(
        self,
        agent_id: str,
        model: str | None = None,
        system_prompt: str | None = None,
        tools: list[str] | None = None,
        max_turns: int | None = None,
        timeout_seconds: int | None = None,
    ) -> Agent:
        """Update an agent's configuration.

        Args:
            agent_id: Agent ID or name.
            model: New model (optional).
            system_prompt: New system prompt (optional).
            tools: New tools list (optional).
            max_turns: New max turns (optional).
            timeout_seconds: New timeout (optional).

        Returns:
            The updated agent.
        """
        return _run_sync(
            self._async_client.update_agent(
                agent_id=agent_id,
                model=model,
                system_prompt=system_prompt,
                tools=tools,
                max_turns=max_turns,
                timeout_seconds=timeout_seconds,
            )
        )

    def delete_agent(self, agent_id: str) -> None:
        """Delete an agent.

        Args:
            agent_id: Agent ID or name.
        """
        _run_sync(self._async_client.delete_agent(agent_id))

    # ==================== RUNS ====================

    def run(
        self,
        agent_id: str,
        prompt: str,
        session_id: str | None = None,
        wait: bool = True,
        poll_interval: float = 1.0,
    ) -> Run:
        """Run an agent with a prompt.

        Args:
            agent_id: Agent ID or name.
            prompt: The prompt to send to the agent.
            session_id: Optional session ID for multi-turn conversations.
            wait: If True, wait for the run to complete.
            poll_interval: Seconds between status polls when waiting.

        Returns:
            The run (completed if wait=True, otherwise initial status).
        """
        return _run_sync(
            self._async_client.run(
                agent_id=agent_id,
                prompt=prompt,
                session_id=session_id,
                wait=wait,
                poll_interval=poll_interval,
            )
        )

    def stream(
        self,
        agent_id: str,
        prompt: str,
        session_id: str | None = None,
    ) -> Iterator[RunEvent]:
        """Stream run events for an agent execution.

        This method creates a run and yields SSE events as they arrive.

        Args:
            agent_id: Agent ID or name.
            prompt: The prompt to send to the agent.
            session_id: Optional session ID for multi-turn conversations.

        Yields:
            RunEvent objects as they arrive from the stream.

        Example:
            ```python
            for event in client.stream("my-agent", "Hello"):
                if isinstance(event, MessageDeltaEvent):
                    print(event.content, end="", flush=True)
            ```
        """

        # Collect all events from async generator
        async def collect_events() -> list[RunEvent]:
            events = []
            async for event in self._async_client.stream(
                agent_id=agent_id,
                prompt=prompt,
                session_id=session_id,
            ):
                events.append(event)
            return events

        events = _run_sync(collect_events())
        yield from events

    def get_run(self, run_id: str) -> Run:
        """Get a run by ID.

        Args:
            run_id: Run ID (with or without run_ prefix).

        Returns:
            The run.
        """
        return _run_sync(self._async_client.get_run(run_id))

    def list_runs(
        self,
        agent_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Run]:
        """List runs.

        Args:
            agent_id: Filter by agent ID or name.
            status: Filter by status.
            limit: Maximum number of runs to return.
            offset: Number of runs to skip.

        Returns:
            List of runs.
        """
        return _run_sync(
            self._async_client.list_runs(
                agent_id=agent_id,
                status=status,
                limit=limit,
                offset=offset,
            )
        )

    def cancel_run(self, run_id: str) -> Run:
        """Cancel a running run.

        Args:
            run_id: Run ID (with or without run_ prefix).

        Returns:
            The cancelled run.
        """
        return _run_sync(self._async_client.cancel_run(run_id))

    def stream_with_metrics(
        self,
        agent_id: str,
        prompt: str,
        session_id: str | None = None,
    ) -> tuple[Iterator[RunEvent], SyncMetricsHandle]:
        """Stream run events with automatic metrics collection.

        Args:
            agent_id: Agent ID or name.
            prompt: The prompt to send to the agent.
            session_id: Optional session ID.

        Returns:
            Tuple of (event iterator, metrics handle).

        Example:
            ```python
            events, metrics_handle = client.stream_with_metrics(
                "my-agent", "Hello"
            )

            for event in events:
                print(event)

            metrics = metrics_handle.metrics
            print(f"Total tokens: {metrics.total_tokens}")
            ```
        """
        collector = MetricsCollector(run_id="pending")
        events_list: list[RunEvent] = []

        async def collect_with_metrics() -> str:
            # Get the run ID from the async client
            agent_resolved = agent_id
            if not agent_resolved.startswith("agt_"):
                agent = await self._async_client.get_agent(agent_resolved)
                agent_resolved = agent.id

            # Create run and stream
            async for event in self._async_client.stream(
                agent_id=agent_resolved,
                prompt=prompt,
                session_id=session_id,
            ):
                collector.process_event(event)
                events_list.append(event)

            return collector._run_id

        _run_sync(collect_with_metrics())

        def event_generator() -> Iterator[RunEvent]:
            yield from events_list

        return event_generator(), SyncMetricsHandle(collector)


class SyncMetricsHandle:
    """Handle to access metrics from a synchronous streaming run."""

    def __init__(self, collector: MetricsCollector) -> None:
        self._collector = collector

    @property
    def metrics(self) -> RunMetrics:
        """Get the collected metrics."""
        return self._collector.metrics
