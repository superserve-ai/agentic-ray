"""Tests for run operations including streaming."""

from __future__ import annotations

import json

import pytest
import respx
from httpx import Response

from superserve_sdk import Superserve
from superserve_sdk.events import (
    MessageDeltaEvent,
    RunCompletedEvent,
    RunFailedEvent,
    RunStartedEvent,
    ToolEndEvent,
    ToolStartEvent,
)
from superserve_sdk.exceptions import ConflictError, NotFoundError

from .conftest import make_agent_dict, make_run_dict, make_sse_event, make_stream_events


class TestRunAgent:
    """Tests for running agents."""

    @pytest.mark.asyncio
    async def test_run_agent_wait(self, api_base_url):
        """Test running agent and waiting for completion."""
        pending_run = make_run_dict(run_id="run_abc", status="pending")
        running_run = make_run_dict(run_id="run_abc", status="running")
        completed_run = make_run_dict(
            run_id="run_abc",
            status="completed",
            output="Hello!",
        )

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=pending_run))
            # Mock polling - first running, then completed
            respx.get(f"{api_base_url}/runs/run_abc").mock(
                side_effect=[
                    Response(200, json=running_run),
                    Response(200, json=completed_run),
                ]
            )

            async with Superserve(api_key="sk_test") as client:
                run = await client.run(
                    "agt_test123",
                    "Hello",
                    wait=True,
                    poll_interval=0.01,
                )

        assert run.status == "completed"
        assert run.output == "Hello!"

    @pytest.mark.asyncio
    async def test_run_agent_no_wait(self, api_base_url):
        """Test running agent without waiting."""
        pending_run = make_run_dict(run_id="run_abc", status="pending")

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=pending_run))

            async with Superserve(api_key="sk_test") as client:
                run = await client.run("agt_test123", "Hello", wait=False)

        assert run.status == "pending"

    @pytest.mark.asyncio
    async def test_run_agent_by_name(self, api_base_url):
        """Test running agent by name."""
        agents_data = [make_agent_dict(agent_id="agt_resolved", name="my-agent")]
        run_data = make_run_dict(agent_id="agt_resolved")

        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": agents_data})
            )
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=run_data))
            respx.get(f"{api_base_url}/runs/run_test456").mock(
                return_value=Response(200, json=run_data)
            )

            async with Superserve(api_key="sk_test") as client:
                run = await client.run("my-agent", "Hello", wait=True)

        assert run.agent_id == "agt_resolved"

    @pytest.mark.asyncio
    async def test_run_with_session(self, api_base_url):
        """Test running agent with session ID."""
        run_data = make_run_dict(session_id="session_123")

        with respx.mock:
            route = respx.post(f"{api_base_url}/runs").mock(
                return_value=Response(201, json=run_data)
            )
            respx.get(f"{api_base_url}/runs/run_test456").mock(
                return_value=Response(200, json=run_data)
            )

            async with Superserve(api_key="sk_test") as client:
                await client.run(
                    "agt_test123",
                    "Hello",
                    session_id="session_123",
                )

        # Verify session_id was sent
        request = route.calls[0].request
        body = json.loads(request.content)
        assert body["session_id"] == "session_123"

    @pytest.mark.asyncio
    async def test_run_agent_not_found(self, api_base_url):
        """Test running non-existent agent."""
        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": []})
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(NotFoundError):
                    await client.run("nonexistent-agent", "Hello")


class TestStreamRun:
    """Tests for streaming run events."""

    @pytest.mark.asyncio
    async def test_stream_events(self, api_base_url):
        """Test streaming run events."""
        run_data = make_run_dict(run_id="run_stream", status="pending")
        events_str = make_stream_events("run_stream")

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=run_data))
            respx.get(f"{api_base_url}/runs/run_stream/events").mock(
                return_value=Response(
                    200,
                    content=events_str.encode(),
                    headers={"content-type": "text/event-stream"},
                )
            )

            async with Superserve(api_key="sk_test") as client:
                events = []
                async for event in client.stream("agt_test123", "Hello"):
                    events.append(event)

        # Verify event sequence
        assert len(events) == 7
        assert isinstance(events[0], RunStartedEvent)
        assert isinstance(events[1], MessageDeltaEvent)
        assert isinstance(events[2], MessageDeltaEvent)
        assert isinstance(events[3], ToolStartEvent)
        assert isinstance(events[4], ToolEndEvent)
        assert isinstance(events[5], MessageDeltaEvent)
        assert isinstance(events[6], RunCompletedEvent)

    @pytest.mark.asyncio
    async def test_stream_message_content(self, api_base_url):
        """Test streaming message delta content."""
        run_data = make_run_dict(run_id="run_msg", status="pending")
        events_str = (
            make_sse_event("run.started", {"run_id": "run_msg"})
            + make_sse_event("message.delta", {"run_id": "run_msg", "content": "Hello, "})
            + make_sse_event("message.delta", {"run_id": "run_msg", "content": "world!"})
            + make_sse_event("run.completed", {"run_id": "run_msg", "output": "Hello, world!"})
        )

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=run_data))
            respx.get(f"{api_base_url}/runs/run_msg/events").mock(
                return_value=Response(
                    200,
                    content=events_str.encode(),
                    headers={"content-type": "text/event-stream"},
                )
            )

            async with Superserve(api_key="sk_test") as client:
                content = ""
                async for event in client.stream("agt_test123", "Hi"):
                    if isinstance(event, MessageDeltaEvent):
                        content += event.content

        assert content == "Hello, world!"

    @pytest.mark.asyncio
    async def test_stream_tool_events(self, api_base_url):
        """Test streaming tool events."""
        run_data = make_run_dict(run_id="run_tool", status="pending")
        events_str = (
            make_sse_event("run.started", {"run_id": "run_tool"})
            + make_sse_event(
                "tool.start",
                {
                    "run_id": "run_tool",
                    "tool": "Bash",
                    "tool_call_id": "tc_1",
                    "input": {"command": "ls"},
                },
            )
            + make_sse_event(
                "tool.end",
                {
                    "run_id": "run_tool",
                    "tool": "Bash",
                    "tool_call_id": "tc_1",
                    "output": "file.txt",
                    "duration_ms": 50,
                    "success": True,
                },
            )
            + make_sse_event("run.completed", {"run_id": "run_tool"})
        )

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=run_data))
            respx.get(f"{api_base_url}/runs/run_tool/events").mock(
                return_value=Response(
                    200,
                    content=events_str.encode(),
                    headers={"content-type": "text/event-stream"},
                )
            )

            async with Superserve(api_key="sk_test") as client:
                tool_events = []
                async for event in client.stream("agt_test123", "List files"):
                    if isinstance(event, ToolStartEvent | ToolEndEvent):
                        tool_events.append(event)

        assert len(tool_events) == 2
        assert tool_events[0].tool == "Bash"
        assert tool_events[0].input == {"command": "ls"}
        assert tool_events[1].output == "file.txt"
        assert tool_events[1].duration_ms == 50

    @pytest.mark.asyncio
    async def test_stream_failed_run(self, api_base_url):
        """Test streaming a failed run."""
        run_data = make_run_dict(run_id="run_fail", status="pending")
        events_str = make_sse_event("run.started", {"run_id": "run_fail"}) + make_sse_event(
            "run.failed",
            {
                "run_id": "run_fail",
                "error": {"code": "timeout", "message": "Agent timed out"},
            },
        )

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=run_data))
            respx.get(f"{api_base_url}/runs/run_fail/events").mock(
                return_value=Response(
                    200,
                    content=events_str.encode(),
                    headers={"content-type": "text/event-stream"},
                )
            )

            async with Superserve(api_key="sk_test") as client:
                events = []
                async for event in client.stream("agt_test123", "Timeout test"):
                    events.append(event)

        assert len(events) == 2
        assert isinstance(events[1], RunFailedEvent)
        assert events[1].error_message == "Agent timed out"


class TestGetRun:
    """Tests for getting a single run."""

    @pytest.mark.asyncio
    async def test_get_run_by_id(self, api_base_url):
        """Test getting run by ID."""
        run_data = make_run_dict(run_id="run_get123")

        with respx.mock:
            respx.get(f"{api_base_url}/runs/run_get123").mock(
                return_value=Response(200, json=run_data)
            )

            async with Superserve(api_key="sk_test") as client:
                run = await client.get_run("run_get123")

        assert run.id == "run_get123"

    @pytest.mark.asyncio
    async def test_get_run_without_prefix(self, api_base_url):
        """Test getting run by ID without run_ prefix."""
        run_data = make_run_dict(run_id="run_abc123")

        with respx.mock:
            respx.get(f"{api_base_url}/runs/run_abc123").mock(
                return_value=Response(200, json=run_data)
            )

            async with Superserve(api_key="sk_test") as client:
                run = await client.get_run("abc123")

        assert run.id == "run_abc123"

    @pytest.mark.asyncio
    async def test_get_run_not_found(self, api_base_url):
        """Test getting non-existent run."""
        with respx.mock:
            respx.get(f"{api_base_url}/runs/run_nonexistent").mock(
                return_value=Response(404, json={"detail": "Run not found"})
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(NotFoundError):
                    await client.get_run("run_nonexistent")


class TestListRuns:
    """Tests for listing runs."""

    @pytest.mark.asyncio
    async def test_list_runs_success(self, api_base_url):
        """Test successful run listing."""
        runs_data = [
            make_run_dict(run_id="run_1"),
            make_run_dict(run_id="run_2"),
        ]

        with respx.mock:
            respx.get(f"{api_base_url}/runs").mock(
                return_value=Response(200, json={"runs": runs_data})
            )

            async with Superserve(api_key="sk_test") as client:
                runs = await client.list_runs()

        assert len(runs) == 2

    @pytest.mark.asyncio
    async def test_list_runs_by_agent(self, api_base_url):
        """Test listing runs filtered by agent."""
        runs_data = [make_run_dict(agent_id="agt_filter")]

        with respx.mock:
            route = respx.get(f"{api_base_url}/runs").mock(
                return_value=Response(200, json={"runs": runs_data})
            )

            async with Superserve(api_key="sk_test") as client:
                await client.list_runs(agent_id="agt_filter")

        request = route.calls[0].request
        assert "agent_id=agt_filter" in str(request.url)

    @pytest.mark.asyncio
    async def test_list_runs_by_agent_name(self, api_base_url):
        """Test listing runs filtered by agent name."""
        agents_data = [make_agent_dict(agent_id="agt_named", name="my-agent")]
        runs_data = [make_run_dict(agent_id="agt_named")]

        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": agents_data})
            )
            route = respx.get(f"{api_base_url}/runs").mock(
                return_value=Response(200, json={"runs": runs_data})
            )

            async with Superserve(api_key="sk_test") as client:
                await client.list_runs(agent_id="my-agent")

        request = route.calls[0].request
        assert "agent_id=agt_named" in str(request.url)

    @pytest.mark.asyncio
    async def test_list_runs_by_status(self, api_base_url):
        """Test listing runs filtered by status."""
        runs_data = [make_run_dict(status="running")]

        with respx.mock:
            route = respx.get(f"{api_base_url}/runs").mock(
                return_value=Response(200, json={"runs": runs_data})
            )

            async with Superserve(api_key="sk_test") as client:
                await client.list_runs(status="running")

        request = route.calls[0].request
        assert "status=running" in str(request.url)

    @pytest.mark.asyncio
    async def test_list_runs_pagination(self, api_base_url):
        """Test run listing with pagination."""
        runs_data = []

        with respx.mock:
            route = respx.get(f"{api_base_url}/runs").mock(
                return_value=Response(200, json={"runs": runs_data})
            )

            async with Superserve(api_key="sk_test") as client:
                await client.list_runs(limit=5, offset=10)

        request = route.calls[0].request
        assert "limit=5" in str(request.url)
        assert "offset=10" in str(request.url)


class TestCancelRun:
    """Tests for cancelling runs."""

    @pytest.mark.asyncio
    async def test_cancel_run_success(self, api_base_url):
        """Test successful run cancellation."""
        cancelled_run = make_run_dict(run_id="run_cancel", status="cancelled")

        with respx.mock:
            respx.post(f"{api_base_url}/runs/run_cancel/cancel").mock(
                return_value=Response(200, json=cancelled_run)
            )

            async with Superserve(api_key="sk_test") as client:
                run = await client.cancel_run("run_cancel")

        assert run.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_run_without_prefix(self, api_base_url):
        """Test cancelling run without run_ prefix."""
        cancelled_run = make_run_dict(run_id="run_xyz", status="cancelled")

        with respx.mock:
            respx.post(f"{api_base_url}/runs/run_xyz/cancel").mock(
                return_value=Response(200, json=cancelled_run)
            )

            async with Superserve(api_key="sk_test") as client:
                run = await client.cancel_run("xyz")

        assert run.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_already_completed(self, api_base_url):
        """Test cancelling already completed run."""
        with respx.mock:
            respx.post(f"{api_base_url}/runs/run_done/cancel").mock(
                return_value=Response(
                    409,
                    json={
                        "detail": "Run is already completed",
                    },
                )
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(ConflictError):
                    await client.cancel_run("run_done")

    @pytest.mark.asyncio
    async def test_cancel_run_not_found(self, api_base_url):
        """Test cancelling non-existent run."""
        with respx.mock:
            respx.post(f"{api_base_url}/runs/run_nonexistent/cancel").mock(
                return_value=Response(404, json={"detail": "Run not found"})
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(NotFoundError):
                    await client.cancel_run("run_nonexistent")


class TestStreamWithMetrics:
    """Tests for streaming with metrics collection."""

    @pytest.mark.asyncio
    async def test_stream_with_metrics(self, api_base_url):
        """Test streaming with metrics collection."""
        run_data = make_run_dict(run_id="run_metrics", status="pending")
        events_str = (
            make_sse_event("run.started", {"run_id": "run_metrics"})
            + make_sse_event("message.delta", {"run_id": "run_metrics", "content": "Hi"})
            + make_sse_event(
                "tool.start",
                {
                    "run_id": "run_metrics",
                    "tool": "Read",
                    "tool_call_id": "tc_1",
                    "input": {"path": "/test"},
                },
            )
            + make_sse_event(
                "tool.end",
                {
                    "run_id": "run_metrics",
                    "tool": "Read",
                    "tool_call_id": "tc_1",
                    "output": "content",
                    "duration_ms": 100,
                    "success": True,
                },
            )
            + make_sse_event(
                "run.completed",
                {
                    "run_id": "run_metrics",
                    "output": "Done",
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "total_tokens": 150,
                    },
                    "turns": 2,
                    "duration_ms": 2000,
                    "tools_used": ["Read"],
                },
            )
        )

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=run_data))
            respx.get(f"{api_base_url}/runs/run_metrics/events").mock(
                return_value=Response(
                    200,
                    content=events_str.encode(),
                    headers={"content-type": "text/event-stream"},
                )
            )

            async with Superserve(api_key="sk_test") as client:
                events, metrics_handle = await client.stream_with_metrics(
                    "agt_test123",
                    "Test",
                )

                event_list = []
                async for event in events:
                    event_list.append(event)

                metrics = metrics_handle.metrics

        assert len(event_list) == 5
        assert metrics.total_tokens == 150
        assert metrics.input_tokens == 100
        assert metrics.output_tokens == 50
        assert metrics.turns == 2
        assert metrics.duration_ms == 2000
        assert "Read" in metrics.tools_used
        assert len(metrics.tool_calls) == 1
        assert metrics.tool_calls[0].name == "Read"
