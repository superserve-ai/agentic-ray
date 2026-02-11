"""Async HTTP client for Superserve API."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from .metrics import MetricsCollector, RunMetrics

from .auth import AuthProvider
from .constants import DEFAULT_MODEL
from .events import RunEvent, parse_event
from .exceptions import (
    ConnectionError,
    StreamError,
    TimeoutError,
    raise_for_status,
)
from .models import Agent, AgentConfig, AgentUpdateConfig, Run

# Default configuration
DEFAULT_BASE_URL = "https://api.superserve.ai"
DEFAULT_TIMEOUT = 30.0
DEFAULT_STREAM_TIMEOUT = 300.0
USER_AGENT = "superserve-sdk-python/0.1.0"


class Superserve:
    """Async client for the Superserve API.

    This is the main entry point for interacting with Superserve hosted agents.

    Example:
        ```python
        import asyncio
        from superserve_sdk import Superserve

        async def main():
            async with Superserve() as client:
                # Create an agent
                agent = await client.create_agent(
                    name="my-agent",
                    model="claude-sonnet-4-5-20250929",
                )

                # Run the agent
                run = await client.run(agent.id, "What is 2+2?")
                print(run.output)

        asyncio.run(main())
        ```
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        credentials_path: Path | None = None,
    ) -> None:
        """Initialize the Superserve client.

        Args:
            api_key: API key for authentication. If not provided, will be read
                from SUPERSERVE_API_KEY env var or ~/.superserve/credentials.json.
            base_url: Base URL for the Superserve API.
            timeout: Default request timeout in seconds.
            credentials_path: Path to credentials file.
        """
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._auth = AuthProvider(api_key=api_key, credentials_path=credentials_path)
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> Superserve:
        """Enter async context manager."""
        await self._ensure_client()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Exit async context manager."""
        await self.close()

    async def _ensure_client(self) -> httpx.AsyncClient:
        """Ensure the HTTP client is initialized."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=f"{self._base_url}/v1",
                timeout=httpx.Timeout(self._timeout),
                headers={
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/json",
                },
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _get_headers(self) -> dict[str, str]:
        """Get request headers including authorization."""
        return self._auth.get_headers()

    async def _request(
        self,
        method: str,
        endpoint: str,
        json_data: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Make a request to the API.

        Args:
            method: HTTP method.
            endpoint: API endpoint.
            json_data: JSON body data.
            params: Query parameters.

        Returns:
            Parsed JSON response.

        Raises:
            APIError: On API errors.
            ConnectionError: On connection errors.
            TimeoutError: On timeout.
        """
        client = await self._ensure_client()

        try:
            response = await client.request(
                method,
                endpoint,
                headers=self._get_headers(),
                json=json_data,
                params=params,
            )

            # Handle empty responses
            if response.status_code == 204:
                return {}

            data = response.json() if response.content else {}
            raise_for_status(response.status_code, data)

            return data

        except httpx.ConnectError as e:
            raise ConnectionError(f"Cannot connect to Superserve API: {e}", e) from e
        except httpx.TimeoutException as e:
            raise TimeoutError(f"Request timed out after {self._timeout}s", self._timeout) from e

    # ==================== AGENTS ====================

    async def create_agent(
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

        Raises:
            ValidationError: If the configuration is invalid.
            ConflictError: If an agent with this name already exists.
        """
        config = AgentConfig(
            name=name,
            model=model,
            system_prompt=system_prompt,
            tools=tools or ["Bash", "Read", "Write", "Glob", "Grep"],
            max_turns=max_turns,
            timeout_seconds=timeout_seconds,
        )

        data = await self._request(
            "POST",
            "/agents",
            json_data=config.model_dump(),
        )

        return Agent.model_validate(data)

    async def list_agents(
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
        data = await self._request(
            "GET",
            "/agents",
            params={"limit": limit, "offset": offset},
        )

        return [Agent.model_validate(a) for a in data.get("agents", [])]

    async def get_agent(self, agent_id: str) -> Agent:
        """Get an agent by ID or name.

        Args:
            agent_id: Agent ID (with or without agt_ prefix) or agent name.

        Returns:
            The agent.

        Raises:
            NotFoundError: If the agent is not found.
        """
        # If it looks like an ID, fetch directly
        if agent_id.startswith("agt_"):
            data = await self._request("GET", f"/agents/{agent_id}")
            return Agent.model_validate(data)

        # Otherwise, search by name
        agents = await self.list_agents(limit=100)
        for agent in agents:
            if agent.name == agent_id:
                return agent

        from .exceptions import NotFoundError

        raise NotFoundError("Agent", agent_id)

    async def update_agent(
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

        Raises:
            NotFoundError: If the agent is not found.
        """
        # Resolve name to ID if needed
        if not agent_id.startswith("agt_"):
            agent = await self.get_agent(agent_id)
            agent_id = agent.id

        update = AgentUpdateConfig(
            model=model,
            system_prompt=system_prompt,
            tools=tools,
            max_turns=max_turns,
            timeout_seconds=timeout_seconds,
        )

        # Only include non-None values
        update_data = {k: v for k, v in update.model_dump().items() if v is not None}

        data = await self._request(
            "PATCH",
            f"/agents/{agent_id}",
            json_data=update_data,
        )

        return Agent.model_validate(data)

    async def delete_agent(self, agent_id: str) -> None:
        """Delete an agent.

        Args:
            agent_id: Agent ID or name.

        Raises:
            NotFoundError: If the agent is not found.
        """
        # Resolve name to ID if needed
        if not agent_id.startswith("agt_"):
            agent = await self.get_agent(agent_id)
            agent_id = agent.id

        await self._request("DELETE", f"/agents/{agent_id}")

    # ==================== RUNS ====================

    async def run(
        self,
        agent_id: str,
        prompt: str,
        session_id: str | None = None,
        wait: bool = True,
        poll_interval: float = 1.0,
    ) -> Run:
        """Run an agent with a prompt.

        This method creates a run and optionally waits for it to complete.

        Args:
            agent_id: Agent ID or name.
            prompt: The prompt to send to the agent.
            session_id: Optional session ID for multi-turn conversations.
            wait: If True, wait for the run to complete.
            poll_interval: Seconds between status polls when waiting.

        Returns:
            The run (completed if wait=True, otherwise initial status).

        Raises:
            NotFoundError: If the agent is not found.
        """
        import asyncio

        # Resolve name to ID if needed
        if not agent_id.startswith("agt_"):
            agent = await self.get_agent(agent_id)
            agent_id = agent.id

        # Create the run
        data = await self._request(
            "POST",
            "/runs",
            json_data={
                "agent_id": agent_id,
                "prompt": prompt,
                "session_id": session_id,
            },
        )

        run = Run.model_validate(data)

        if not wait:
            return run

        # Poll until complete
        while run.status in ("pending", "running"):
            await asyncio.sleep(poll_interval)
            run = await self.get_run(run.id)

        return run

    async def stream(
        self,
        agent_id: str,
        prompt: str,
        session_id: str | None = None,
    ) -> AsyncIterator[RunEvent]:
        """Stream run events for an agent execution.

        This method creates a run and yields SSE events as they arrive.

        Args:
            agent_id: Agent ID or name.
            prompt: The prompt to send to the agent.
            session_id: Optional session ID for multi-turn conversations.

        Yields:
            RunEvent objects as they arrive from the stream.

        Raises:
            NotFoundError: If the agent is not found.
            StreamError: If streaming fails.

        Example:
            ```python
            async for event in client.stream("my-agent", "Hello"):
                if isinstance(event, MessageDeltaEvent):
                    print(event.content, end="", flush=True)
            ```
        """
        # Resolve name to ID if needed
        if not agent_id.startswith("agt_"):
            agent = await self.get_agent(agent_id)
            agent_id = agent.id

        # Create the run
        data = await self._request(
            "POST",
            "/runs",
            json_data={
                "agent_id": agent_id,
                "prompt": prompt,
                "session_id": session_id,
            },
        )

        run = Run.model_validate(data)

        # Stream events
        async for event in self._stream_run_events(run.id):
            yield event

    async def _stream_run_events(self, run_id: str) -> AsyncIterator[RunEvent]:
        """Stream SSE events for a run.

        Args:
            run_id: Run ID.

        Yields:
            RunEvent objects.
        """
        client = await self._ensure_client()

        if not run_id.startswith("run_"):
            run_id = f"run_{run_id}"

        try:
            async with client.stream(
                "GET",
                f"/runs/{run_id}/events",
                headers=self._get_headers(),
                timeout=httpx.Timeout(DEFAULT_STREAM_TIMEOUT),
            ) as response:
                raise_for_status(response.status_code, None)

                current_event_type: str | None = None

                async for line in response.aiter_lines():
                    if not line:
                        continue

                    if line.startswith("event: "):
                        current_event_type = line[7:]
                    elif line.startswith("data: ") and current_event_type:
                        try:
                            data = json.loads(line[6:])
                            # Add run_id to data if not present
                            if "run_id" not in data:
                                data["run_id"] = run_id
                            yield parse_event(current_event_type, data)
                        except (json.JSONDecodeError, ValueError):
                            continue
                        current_event_type = None

        except httpx.ConnectError as e:
            raise StreamError(f"Connection lost during streaming: {e}", e) from e
        except httpx.TimeoutException as e:
            raise StreamError(f"Stream timed out: {e}", e) from e

    async def get_run(self, run_id: str) -> Run:
        """Get a run by ID.

        Args:
            run_id: Run ID (with or without run_ prefix).

        Returns:
            The run.

        Raises:
            NotFoundError: If the run is not found.
        """
        if not run_id.startswith("run_"):
            run_id = f"run_{run_id}"

        data = await self._request("GET", f"/runs/{run_id}")
        return Run.model_validate(data)

    async def list_runs(
        self,
        agent_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Run]:
        """List runs.

        Args:
            agent_id: Filter by agent ID or name.
            status: Filter by status (pending, running, completed, failed, cancelled).
            limit: Maximum number of runs to return.
            offset: Number of runs to skip.

        Returns:
            List of runs.
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}

        if agent_id:
            # Resolve name to ID if needed
            if not agent_id.startswith("agt_"):
                agent = await self.get_agent(agent_id)
                agent_id = agent.id
            params["agent_id"] = agent_id

        if status:
            params["status"] = status

        data = await self._request("GET", "/runs", params=params)
        return [Run.model_validate(r) for r in data.get("runs", [])]

    async def cancel_run(self, run_id: str) -> Run:
        """Cancel a running run.

        Args:
            run_id: Run ID (with or without run_ prefix).

        Returns:
            The cancelled run.

        Raises:
            NotFoundError: If the run is not found.
            ConflictError: If the run cannot be cancelled (already completed).
        """
        if not run_id.startswith("run_"):
            run_id = f"run_{run_id}"

        data = await self._request("POST", f"/runs/{run_id}/cancel")
        return Run.model_validate(data)

    # ==================== STREAMING WITH METRICS ====================

    async def stream_with_metrics(
        self,
        agent_id: str,
        prompt: str,
        session_id: str | None = None,
    ) -> tuple[AsyncIterator[RunEvent], MetricsCollectorHandle]:
        """Stream run events with automatic metrics collection.

        This is a convenience method that sets up a MetricsCollector
        alongside the event stream.

        Args:
            agent_id: Agent ID or name.
            prompt: The prompt to send to the agent.
            session_id: Optional session ID.

        Returns:
            Tuple of (event iterator, metrics handle).

        Example:
            ```python
            events, metrics_handle = await client.stream_with_metrics(
                "my-agent", "Hello"
            )

            async for event in events:
                print(event)

            metrics = metrics_handle.metrics
            print(f"Total tokens: {metrics.total_tokens}")
            ```
        """
        from .metrics import MetricsCollector

        # Resolve name to ID if needed
        if not agent_id.startswith("agt_"):
            agent = await self.get_agent(agent_id)
            agent_id = agent.id

        # Create the run
        data = await self._request(
            "POST",
            "/runs",
            json_data={
                "agent_id": agent_id,
                "prompt": prompt,
                "session_id": session_id,
            },
        )

        run = Run.model_validate(data)
        collector = MetricsCollector(run.id)

        async def event_generator() -> AsyncIterator[RunEvent]:
            async for event in self._stream_run_events(run.id):
                collector.process_event(event)
                yield event

        return event_generator(), MetricsCollectorHandle(collector)


class MetricsCollectorHandle:
    """Handle to access metrics from a streaming run."""

    def __init__(self, collector: MetricsCollector) -> None:
        self._collector = collector

    @property
    def metrics(self) -> RunMetrics:
        """Get the current metrics."""

        return self._collector.metrics
