"""Shared fixtures and configuration for tests."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest
import respx
from httpx import Response

from superserve_sdk.models import Agent, Run, UsageMetrics

# ==================== MOCK DATA ====================


def make_agent_dict(
    agent_id: str = "agt_test123",
    name: str = "test-agent",
    model: str = "claude-sonnet-4-20250514",
    system_prompt: str = "You are a test assistant.",
    tools: list[str] | None = None,
    max_turns: int = 10,
    timeout_seconds: int = 300,
    status: str = "active",
) -> dict[str, Any]:
    """Create a mock agent dictionary."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": agent_id,
        "name": name,
        "model": model,
        "system_prompt": system_prompt,
        "tools": tools or ["Bash", "Read", "Write"],
        "max_turns": max_turns,
        "timeout_seconds": timeout_seconds,
        "status": status,
        "created_at": now,
        "updated_at": now,
    }


def make_run_dict(
    run_id: str = "run_test456",
    agent_id: str = "agt_test123",
    status: str = "completed",
    prompt: str = "Hello, world!",
    output: str | None = "Hello! How can I help you?",
    error_message: str | None = None,
    session_id: str | None = None,
    input_tokens: int = 100,
    output_tokens: int = 50,
    turns: int = 1,
    duration_ms: int = 1500,
    tools_used: list[str] | None = None,
) -> dict[str, Any]:
    """Create a mock run dictionary."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": run_id,
        "agent_id": agent_id,
        "status": status,
        "prompt": prompt,
        "output": output,
        "error_message": error_message,
        "session_id": session_id,
        "usage": (
            {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            }
            if status == "completed"
            else None
        ),
        "turns": turns,
        "duration_ms": duration_ms,
        "tools_used": tools_used or [],
        "created_at": now,
        "started_at": now if status != "pending" else None,
        "completed_at": now if status in ("completed", "failed", "cancelled") else None,
    }


def make_sse_event(event_type: str, data: dict[str, Any]) -> str:
    """Create a raw SSE event string."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


def make_stream_events(run_id: str = "run_test456") -> str:
    """Create a complete SSE event stream."""
    events = [
        make_sse_event("run.started", {"run_id": run_id}),
        make_sse_event("message.delta", {"run_id": run_id, "content": "Hello"}),
        make_sse_event("message.delta", {"run_id": run_id, "content": "!"}),
        make_sse_event(
            "tool.start",
            {
                "run_id": run_id,
                "tool": "Read",
                "tool_call_id": "tc_123",
                "input": {"file_path": "/test.txt"},
            },
        ),
        make_sse_event(
            "tool.end",
            {
                "run_id": run_id,
                "tool": "Read",
                "tool_call_id": "tc_123",
                "output": "file contents",
                "duration_ms": 50,
                "success": True,
            },
        ),
        make_sse_event("message.delta", {"run_id": run_id, "content": " Done."}),
        make_sse_event(
            "run.completed",
            {
                "run_id": run_id,
                "output": "Hello! Done.",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "total_tokens": 150,
                },
                "turns": 2,
                "duration_ms": 2000,
                "tools_used": ["Read"],
            },
        ),
    ]
    return "".join(events)


# ==================== FIXTURES ====================


@pytest.fixture
def mock_agent_data() -> dict[str, Any]:
    """Fixture for a mock agent dictionary."""
    return make_agent_dict()


@pytest.fixture
def mock_agent(mock_agent_data: dict[str, Any]) -> Agent:
    """Fixture for a mock Agent object."""
    return Agent.model_validate(mock_agent_data)


@pytest.fixture
def mock_run_data() -> dict[str, Any]:
    """Fixture for a mock run dictionary."""
    return make_run_dict()


@pytest.fixture
def mock_run(mock_run_data: dict[str, Any]) -> Run:
    """Fixture for a mock Run object."""
    return Run.model_validate(mock_run_data)


@pytest.fixture
def mock_usage() -> UsageMetrics:
    """Fixture for mock usage metrics."""
    return UsageMetrics(
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
    )


@pytest.fixture
def api_base_url() -> str:
    """Base URL for API mocks."""
    return "https://api.superserve.ai/v1"


@pytest.fixture
def respx_mock():
    """Fixture for respx mocking."""
    with respx.mock(assert_all_called=False) as mock:
        yield mock


@pytest.fixture
def mock_api_key() -> str:
    """Mock API key for testing."""
    return "sk_test_12345678901234567890"


@pytest.fixture
def temp_credentials_file(tmp_path, mock_api_key):
    """Create a temporary credentials file."""
    creds_dir = tmp_path / ".superserve"
    creds_dir.mkdir()
    creds_file = creds_dir / "credentials.json"
    creds_file.write_text(json.dumps({"api_key": mock_api_key}))
    return creds_file


# ==================== API MOCK HELPERS ====================


def mock_agents_list(
    respx_mock,
    base_url: str,
    agents: list[dict[str, Any]] | None = None,
) -> None:
    """Mock the list agents endpoint."""
    agents = agents or [make_agent_dict()]
    respx_mock.get(f"{base_url}/agents").mock(return_value=Response(200, json={"agents": agents}))


def mock_agent_create(
    respx_mock,
    base_url: str,
    agent_data: dict[str, Any] | None = None,
) -> None:
    """Mock the create agent endpoint."""
    agent_data = agent_data or make_agent_dict()
    respx_mock.post(f"{base_url}/agents").mock(return_value=Response(201, json=agent_data))


def mock_agent_get(
    respx_mock,
    base_url: str,
    agent_id: str = "agt_test123",
    agent_data: dict[str, Any] | None = None,
) -> None:
    """Mock the get agent endpoint."""
    agent_data = agent_data or make_agent_dict(agent_id=agent_id)
    respx_mock.get(f"{base_url}/agents/{agent_id}").mock(
        return_value=Response(200, json=agent_data)
    )


def mock_agent_update(
    respx_mock,
    base_url: str,
    agent_id: str = "agt_test123",
    agent_data: dict[str, Any] | None = None,
) -> None:
    """Mock the update agent endpoint."""
    agent_data = agent_data or make_agent_dict(agent_id=agent_id)
    respx_mock.patch(f"{base_url}/agents/{agent_id}").mock(
        return_value=Response(200, json=agent_data)
    )


def mock_agent_delete(
    respx_mock,
    base_url: str,
    agent_id: str = "agt_test123",
) -> None:
    """Mock the delete agent endpoint."""
    respx_mock.delete(f"{base_url}/agents/{agent_id}").mock(return_value=Response(204))


def mock_run_create(
    respx_mock,
    base_url: str,
    run_data: dict[str, Any] | None = None,
) -> None:
    """Mock the create run endpoint."""
    run_data = run_data or make_run_dict(status="pending")
    respx_mock.post(f"{base_url}/runs").mock(return_value=Response(201, json=run_data))


def mock_run_get(
    respx_mock,
    base_url: str,
    run_id: str = "run_test456",
    run_data: dict[str, Any] | None = None,
) -> None:
    """Mock the get run endpoint."""
    run_data = run_data or make_run_dict(run_id=run_id)
    respx_mock.get(f"{base_url}/runs/{run_id}").mock(return_value=Response(200, json=run_data))


def mock_runs_list(
    respx_mock,
    base_url: str,
    runs: list[dict[str, Any]] | None = None,
) -> None:
    """Mock the list runs endpoint."""
    runs = runs or [make_run_dict()]
    respx_mock.get(f"{base_url}/runs").mock(return_value=Response(200, json={"runs": runs}))


def mock_run_cancel(
    respx_mock,
    base_url: str,
    run_id: str = "run_test456",
    run_data: dict[str, Any] | None = None,
) -> None:
    """Mock the cancel run endpoint."""
    run_data = run_data or make_run_dict(run_id=run_id, status="cancelled")
    respx_mock.post(f"{base_url}/runs/{run_id}/cancel").mock(
        return_value=Response(200, json=run_data)
    )


def mock_run_events(
    respx_mock,
    base_url: str,
    run_id: str = "run_test456",
    events_data: str | None = None,
) -> None:
    """Mock the run events SSE endpoint."""
    events_data = events_data or make_stream_events(run_id)
    respx_mock.get(f"{base_url}/runs/{run_id}/events").mock(
        return_value=Response(
            200,
            content=events_data.encode(),
            headers={"content-type": "text/event-stream"},
        )
    )
