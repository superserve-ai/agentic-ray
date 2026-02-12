"""Tests for synchronous wrapper."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
import respx
from httpx import Response

from superserve_sdk import SuperserveSync
from superserve_sdk.events import MessageDeltaEvent, RunCompletedEvent, RunStartedEvent
from superserve_sdk.exceptions import NotFoundError

from .conftest import make_agent_dict, make_run_dict, make_sse_event


class TestSuperserveSyncInit:
    """Tests for SuperserveSync initialization."""

    def test_default_configuration(self):
        """Test sync client with default configuration."""
        with patch.dict(os.environ, {"SUPERSERVE_API_KEY": "sk_test"}):
            client = SuperserveSync()

        assert client._async_client is not None

    def test_custom_configuration(self):
        """Test sync client with custom configuration."""
        client = SuperserveSync(
            api_key="sk_custom",
            base_url="https://custom.api.com",
            timeout=60.0,
        )

        assert client._async_client._base_url == "https://custom.api.com"
        assert client._async_client._timeout == 60.0


class TestSuperserveSyncContextManager:
    """Tests for SuperserveSync context manager."""

    def test_context_manager(self, api_base_url):
        """Test sync context manager."""
        with respx.mock:
            with SuperserveSync(api_key="sk_test") as client:
                assert client._async_client._client is not None

            assert client._async_client._client is None

    def test_close(self):
        """Test close method."""
        with respx.mock:
            client = SuperserveSync(api_key="sk_test")
            client.close()

            assert client._async_client._client is None


class TestSuperserveSyncAgents:
    """Tests for sync agent operations."""

    def test_create_agent(self, api_base_url):
        """Test sync agent creation."""
        agent_data = make_agent_dict(name="sync-agent")

        with respx.mock:
            respx.post(f"{api_base_url}/agents").mock(return_value=Response(201, json=agent_data))

            with SuperserveSync(api_key="sk_test") as client:
                agent = client.create_agent(name="sync-agent")

        assert agent.name == "sync-agent"

    def test_list_agents(self, api_base_url):
        """Test sync agent listing."""
        agents_data = [make_agent_dict()]

        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": agents_data})
            )

            with SuperserveSync(api_key="sk_test") as client:
                agents = client.list_agents()

        assert len(agents) == 1

    def test_get_agent(self, api_base_url):
        """Test sync get agent."""
        agent_data = make_agent_dict(agent_id="agt_sync123")

        with respx.mock:
            respx.get(f"{api_base_url}/agents/agt_sync123").mock(
                return_value=Response(200, json=agent_data)
            )

            with SuperserveSync(api_key="sk_test") as client:
                agent = client.get_agent("agt_sync123")

        assert agent.id == "agt_sync123"

    def test_update_agent(self, api_base_url):
        """Test sync agent update."""
        updated_agent = make_agent_dict(max_turns=25)

        with respx.mock:
            respx.patch(f"{api_base_url}/agents/agt_test123").mock(
                return_value=Response(200, json=updated_agent)
            )

            with SuperserveSync(api_key="sk_test") as client:
                agent = client.update_agent("agt_test123", max_turns=25)

        assert agent.max_turns == 25

    def test_delete_agent(self, api_base_url):
        """Test sync agent deletion."""
        with respx.mock:
            respx.delete(f"{api_base_url}/agents/agt_test123").mock(return_value=Response(204))

            with SuperserveSync(api_key="sk_test") as client:
                client.delete_agent("agt_test123")

        # Should not raise


class TestSuperserveSyncRuns:
    """Tests for sync run operations."""

    def test_run_agent(self, api_base_url):
        """Test sync run agent."""
        pending_run = make_run_dict(status="pending")
        completed_run = make_run_dict(status="completed", output="Done")

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=pending_run))
            respx.get(f"{api_base_url}/runs/run_test456").mock(
                return_value=Response(200, json=completed_run)
            )

            with SuperserveSync(api_key="sk_test") as client:
                run = client.run("agt_test123", "Hello", wait=True)

        assert run.status == "completed"
        assert run.output == "Done"

    def test_run_agent_no_wait(self, api_base_url):
        """Test sync run without waiting."""
        pending_run = make_run_dict(status="pending")

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=pending_run))

            with SuperserveSync(api_key="sk_test") as client:
                run = client.run("agt_test123", "Hello", wait=False)

        assert run.status == "pending"

    def test_get_run(self, api_base_url):
        """Test sync get run."""
        run_data = make_run_dict()

        with respx.mock:
            respx.get(f"{api_base_url}/runs/run_test456").mock(
                return_value=Response(200, json=run_data)
            )

            with SuperserveSync(api_key="sk_test") as client:
                run = client.get_run("run_test456")

        assert run.id == "run_test456"

    def test_list_runs(self, api_base_url):
        """Test sync list runs."""
        runs_data = [make_run_dict()]

        with respx.mock:
            respx.get(f"{api_base_url}/runs").mock(
                return_value=Response(200, json={"runs": runs_data})
            )

            with SuperserveSync(api_key="sk_test") as client:
                runs = client.list_runs()

        assert len(runs) == 1

    def test_cancel_run(self, api_base_url):
        """Test sync cancel run."""
        cancelled_run = make_run_dict(status="cancelled")

        with respx.mock:
            respx.post(f"{api_base_url}/runs/run_test456/cancel").mock(
                return_value=Response(200, json=cancelled_run)
            )

            with SuperserveSync(api_key="sk_test") as client:
                run = client.cancel_run("run_test456")

        assert run.status == "cancelled"


class TestSuperserveSyncStream:
    """Tests for sync streaming."""

    def test_stream_events(self, api_base_url):
        """Test sync streaming events."""
        run_data = make_run_dict(run_id="run_sync_stream", status="pending")
        events_str = (
            make_sse_event("run.started", {"run_id": "run_sync_stream"})
            + make_sse_event("message.delta", {"run_id": "run_sync_stream", "content": "Hi"})
            + make_sse_event("run.completed", {"run_id": "run_sync_stream"})
        )

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=run_data))
            respx.get(f"{api_base_url}/runs/run_sync_stream/events").mock(
                return_value=Response(
                    200,
                    content=events_str.encode(),
                    headers={"content-type": "text/event-stream"},
                )
            )

            with SuperserveSync(api_key="sk_test") as client:
                events = list(client.stream("agt_test123", "Hello"))

        assert len(events) == 3
        assert isinstance(events[0], RunStartedEvent)
        assert isinstance(events[1], MessageDeltaEvent)
        assert isinstance(events[2], RunCompletedEvent)

    def test_stream_with_metrics(self, api_base_url):
        """Test sync streaming with metrics."""
        run_data = make_run_dict(run_id="run_sync_metrics", status="pending")
        events_str = (
            make_sse_event("run.started", {"run_id": "run_sync_metrics"})
            + make_sse_event("message.delta", {"run_id": "run_sync_metrics", "content": "Test"})
            + make_sse_event(
                "run.completed",
                {
                    "run_id": "run_sync_metrics",
                    "output": "Test",
                    "usage": {
                        "input_tokens": 50,
                        "output_tokens": 25,
                        "total_tokens": 75,
                    },
                    "turns": 1,
                    "duration_ms": 1000,
                },
            )
        )

        with respx.mock:
            respx.post(f"{api_base_url}/runs").mock(return_value=Response(201, json=run_data))
            respx.get(f"{api_base_url}/runs/run_sync_metrics/events").mock(
                return_value=Response(
                    200,
                    content=events_str.encode(),
                    headers={"content-type": "text/event-stream"},
                )
            )

            with SuperserveSync(api_key="sk_test") as client:
                events, metrics_handle = client.stream_with_metrics(
                    "agt_test123",
                    "Hello",
                )

                event_list = list(events)
                metrics = metrics_handle.metrics

        assert len(event_list) == 3
        assert metrics.total_tokens == 75
        assert metrics.success is True


class TestSuperserveSyncErrors:
    """Tests for sync error handling."""

    def test_not_found_error(self, api_base_url):
        """Test sync NotFoundError."""
        with respx.mock:
            respx.get(f"{api_base_url}/agents/agt_nonexistent").mock(
                return_value=Response(404, json={"detail": "Not found"})
            )

            with SuperserveSync(api_key="sk_test") as client:
                with pytest.raises(NotFoundError):
                    client.get_agent("agt_nonexistent")


class TestRunSync:
    """Tests for _run_sync helper function."""

    def test_run_sync_simple(self):
        """Test _run_sync with simple coroutine."""
        from superserve_sdk._sync import _run_sync

        async def simple_coro():
            return 42

        result = _run_sync(simple_coro())

        assert result == 42

    def test_run_sync_with_exception(self):
        """Test _run_sync propagates exceptions."""
        from superserve_sdk._sync import _run_sync

        async def failing_coro():
            raise ValueError("Test error")

        with pytest.raises(ValueError) as exc_info:
            _run_sync(failing_coro())

        assert "Test error" in str(exc_info.value)
