"""Tests for superserve run CLI command and streaming."""

import json
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from superserve.cli.cli import cli
from superserve.cli.platform.client import PlatformAPIError
from superserve.cli.platform.types import (
    Credentials,
    RunEvent,
    RunResponse,
    UsageMetrics,
)


@pytest.fixture
def runner():
    """Provide a CLI runner."""
    return CliRunner()


@pytest.fixture
def mock_credentials():
    """Mock authenticated credentials."""
    return Credentials(token="test-token-123")


def _make_run_response(**overrides) -> RunResponse:
    """Helper to create a RunResponse with defaults."""
    defaults = {
        "id": "run_test-uuid",
        "agent_id": "agt_agent-uuid",
        "status": "pending",
        "prompt": "Hello",
        "created_at": "2026-01-01T00:00:00Z",
    }
    defaults.update(overrides)
    return RunResponse(**defaults)


# ==================== Unit Tests: CLI Command ====================


class TestRunCommand:
    """Tests for superserve run command."""

    def test_run_streams_message_delta(self, runner):
        """Run command streams message.delta content to stdout."""
        events = [
            RunEvent(type="run.started", data={"run_id": "run_123"}),
            RunEvent(type="message.delta", data={"content": "Hello "}),
            RunEvent(type="message.delta", data={"content": "world!"}),
            RunEvent(
                type="run.completed",
                data={
                    "run_id": "run_123",
                    "usage": {
                        "input_tokens": 10,
                        "output_tokens": 5,
                        "total_tokens": 15,
                    },
                    "duration_ms": 1200,
                },
            ),
        ]

        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.create_and_stream_run.return_value = iter(events)
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["run", "my-agent", "Hello"])

            assert result.exit_code == 0
            assert "Hello world!" in result.output
            mock_client.create_and_stream_run.assert_called_once_with(
                "my-agent", "Hello"
            )

    def test_run_json_mode(self, runner):
        """Run command with --json outputs raw JSON events."""
        events = [
            RunEvent(type="run.started", data={"run_id": "run_123"}),
            RunEvent(type="message.delta", data={"content": "Hi"}),
            RunEvent(
                type="run.completed",
                data={
                    "run_id": "run_123",
                    "usage": {"input_tokens": 5, "output_tokens": 3, "total_tokens": 8},
                    "duration_ms": 500,
                },
            ),
        ]

        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.create_and_stream_run.return_value = iter(events)
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["run", "my-agent", "Hello", "--json"])

            assert result.exit_code == 0
            lines = [line for line in result.output.strip().split("\n") if line]
            parsed = [json.loads(line) for line in lines]
            assert parsed[0]["type"] == "run.started"
            assert parsed[1]["type"] == "message.delta"
            assert parsed[1]["data"]["content"] == "Hi"
            assert parsed[2]["type"] == "run.completed"

    def test_run_failed_event(self, runner):
        """Run command exits with error on run.failed event."""
        events = [
            RunEvent(type="run.started", data={"run_id": "run_123"}),
            RunEvent(
                type="run.failed",
                data={
                    "run_id": "run_123",
                    "error": {"message": "Model overloaded"},
                },
            ),
        ]

        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.create_and_stream_run.return_value = iter(events)
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["run", "my-agent", "Hello"])

            assert result.exit_code == 1
            assert "Model overloaded" in result.output

    def test_run_cancelled_event(self, runner):
        """Run command exits on run.cancelled event."""
        events = [
            RunEvent(type="run.started", data={"run_id": "run_123"}),
            RunEvent(type="run.cancelled", data={"run_id": "run_123"}),
        ]

        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.create_and_stream_run.return_value = iter(events)
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["run", "my-agent", "Hello"])

            assert result.exit_code == 130
            assert "cancelled" in result.output.lower()

    def test_run_tool_events(self):
        """Run command displays tool start/end events on stderr."""
        stderr_runner = CliRunner()
        events = [
            RunEvent(type="run.started", data={"run_id": "run_123"}),
            RunEvent(
                type="tool.start",
                data={"tool": "Bash", "input": {"command": "ls -la"}},
            ),
            RunEvent(
                type="tool.end",
                data={"tool": "Bash", "output": "file.txt", "duration_ms": 150},
            ),
            RunEvent(type="message.delta", data={"content": "Done"}),
            RunEvent(
                type="run.completed",
                data={
                    "run_id": "run_123",
                    "usage": {
                        "input_tokens": 20,
                        "output_tokens": 10,
                        "total_tokens": 30,
                    },
                    "duration_ms": 2000,
                },
            ),
        ]

        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.create_and_stream_run.return_value = iter(events)
            mock_client_cls.return_value = mock_client

            result = stderr_runner.invoke(cli, ["run", "my-agent", "Do stuff"])

            assert result.exit_code == 0
            assert "Done" in result.output
            # Tool events go to stderr
            assert "Bash" in result.output

    def test_run_not_authenticated(self, runner):
        """Run command shows auth error when not authenticated."""
        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.create_and_stream_run.side_effect = PlatformAPIError(
                401, "Not authenticated"
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["run", "my-agent", "Hello"])

            assert result.exit_code == 1
            assert "Not authenticated" in result.output

    def test_run_agent_not_found(self, runner):
        """Run command shows error when agent not found."""
        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.create_and_stream_run.side_effect = PlatformAPIError(
                404, "Agent not found"
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["run", "nonexistent", "Hello"])

            assert result.exit_code == 1
            assert "not found" in result.output.lower()

    def test_run_completion_shows_usage(self):
        """Run command shows token usage on completion."""
        stderr_runner = CliRunner()
        events = [
            RunEvent(type="message.delta", data={"content": "Answer"}),
            RunEvent(
                type="run.completed",
                data={
                    "run_id": "run_123",
                    "usage": {
                        "input_tokens": 1500,
                        "output_tokens": 300,
                        "total_tokens": 1800,
                    },
                    "duration_ms": 5000,
                },
            ),
        ]

        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.create_and_stream_run.return_value = iter(events)
            mock_client_cls.return_value = mock_client

            result = stderr_runner.invoke(cli, ["run", "my-agent", "Hello"])

            assert result.exit_code == 0
            assert "1,500" in result.output
            assert "300" in result.output


# ==================== Unit Tests: Client SSE Parsing ====================


class TestClientSSEParsing:
    """Tests for PlatformClient.create_and_stream_run SSE parsing."""

    @staticmethod
    def _make_sse_chunks(events: list[tuple[str, dict]]) -> list[str]:
        """Build raw SSE text chunks from (event_type, data) tuples."""
        chunks = []
        for event_type, data in events:
            chunks.append(f"event: {event_type}\ndata: {json.dumps(data)}\n\n")
        return chunks

    @staticmethod
    def _make_sse_response(chunks: list[str], headers: dict | None = None) -> MagicMock:
        """Build a mock response with iter_content returning SSE chunks."""
        mock_resp = MagicMock()
        mock_resp.iter_content.return_value = iter(chunks)
        mock_resp.headers = headers or {}
        return mock_resp

    def test_parses_single_event(self):
        """Client parses a single SSE event."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient(base_url="https://test.api.com")

        chunks = self._make_sse_chunks([("run.started", {"run_id": "run_123"})])
        mock_resp = self._make_sse_response(chunks, {"X-Run-ID": "run_123"})

        with patch.object(client, "_request", return_value=mock_resp):
            with patch.object(client, "_resolve_agent_id", return_value="agt_abc"):
                events = list(client.create_and_stream_run("my-agent", "Hello"))

        assert len(events) == 1
        assert events[0].type == "run.started"
        assert events[0].data["run_id"] == "run_123"

    def test_parses_multiple_events(self):
        """Client parses multiple SSE events in sequence."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient(base_url="https://test.api.com")

        chunks = self._make_sse_chunks(
            [
                ("run.started", {"run_id": "run_123"}),
                ("message.delta", {"content": "Hello"}),
                ("message.delta", {"content": " world"}),
                (
                    "run.completed",
                    {"run_id": "run_123", "usage": {}, "duration_ms": 100},
                ),
            ]
        )
        mock_resp = self._make_sse_response(chunks, {"X-Run-ID": "run_123"})

        with patch.object(client, "_request", return_value=mock_resp):
            with patch.object(client, "_resolve_agent_id", return_value="agt_abc"):
                events = list(client.create_and_stream_run("my-agent", "Hello"))

        assert len(events) == 4
        assert events[0].type == "run.started"
        assert events[1].type == "message.delta"
        assert events[1].data["content"] == "Hello"
        assert events[2].data["content"] == " world"
        assert events[3].type == "run.completed"

    def test_parses_multiline_data(self):
        """Client handles multiline data fields per SSE spec."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient(base_url="https://test.api.com")

        # Multiline data: two data: lines before blank line
        chunks = ['event: message.delta\ndata: {"content":\ndata: "hello"}\n\n']
        mock_resp = self._make_sse_response(chunks, {"X-Run-ID": "run_123"})

        with patch.object(client, "_request", return_value=mock_resp):
            with patch.object(client, "_resolve_agent_id", return_value="agt_abc"):
                events = list(client.create_and_stream_run("my-agent", "Hello"))

        assert len(events) == 1
        assert events[0].data["content"] == "hello"

    def test_skips_malformed_json(self):
        """Client skips events with invalid JSON data."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient(base_url="https://test.api.com")

        chunks = [
            "event: message.delta\ndata: {invalid json}\n\n",
            'event: message.delta\ndata: {"content": "valid"}\n\n',
        ]
        mock_resp = self._make_sse_response(chunks, {"X-Run-ID": "run_123"})

        with patch.object(client, "_request", return_value=mock_resp):
            with patch.object(client, "_resolve_agent_id", return_value="agt_abc"):
                events = list(client.create_and_stream_run("my-agent", "Hello"))

        # Malformed JSON now returns {"raw": ...} instead of being skipped
        assert len(events) == 2
        assert events[1].data["content"] == "valid"

    def test_extracts_run_id_from_header(self):
        """Client extracts run ID from X-Run-ID response header."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient(base_url="https://test.api.com")

        mock_resp = self._make_sse_response([], {"X-Run-ID": "run_my-run-id"})

        with patch.object(client, "_request", return_value=mock_resp):
            with patch.object(client, "_resolve_agent_id", return_value="agt_abc"):
                list(client.create_and_stream_run("my-agent", "Hello"))

        assert client._current_stream_run_id == "run_my-run-id"

    def test_no_session_id_omitted_from_payload(self):
        """Client omits session_id from payload when not provided."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient(base_url="https://test.api.com")

        mock_resp = self._make_sse_response([])

        with patch.object(client, "_request", return_value=mock_resp) as mock_req:
            with patch.object(client, "_resolve_agent_id", return_value="agt_abc"):
                list(client.create_and_stream_run("my-agent", "Hello"))

        mock_req.assert_called_once_with(
            "POST",
            "/runs/stream",
            json_data={"agent_id": "agt_abc", "prompt": "Hello"},
            stream=True,
        )


# ==================== Unit Tests: Runs Subcommands ====================


class TestRunsListCommand:
    """Tests for superserve runs list command."""

    def test_runs_list(self, runner):
        """Runs list shows recent runs."""
        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.list_runs.return_value = [
                _make_run_response(
                    id="run_abc123",
                    status="completed",
                    duration_ms=3000,
                    created_at="2026-01-01T12:00:00Z",
                ),
            ]
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["runs", "list"])

            assert result.exit_code == 0
            assert "abc123" in result.output
            assert "completed" in result.output

    def test_runs_list_json(self, runner):
        """Runs list with --json outputs JSON."""
        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.list_runs.return_value = [
                _make_run_response(id="run_abc123", status="completed"),
            ]
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["runs", "list", "--json"])

            assert result.exit_code == 0
            data = json.loads(result.output)
            assert isinstance(data, list)
            assert data[0]["id"] == "run_abc123"

    def test_runs_list_with_filters(self, runner):
        """Runs list passes agent and status filters."""
        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.list_runs.return_value = []
            mock_client_cls.return_value = mock_client

            result = runner.invoke(
                cli, ["runs", "list", "--agent", "my-agent", "--status", "failed"]
            )

            assert result.exit_code == 0
            mock_client.list_runs.assert_called_once_with(
                agent_id="my-agent", status="failed", limit=20
            )


class TestRunsGetCommand:
    """Tests for superserve runs get command."""

    def test_runs_get(self, runner):
        """Runs get shows run details."""
        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get_run.return_value = _make_run_response(
                id="run_abc123",
                status="completed",
                prompt="What is 2+2?",
                output="4",
                duration_ms=1500,
                usage=UsageMetrics(input_tokens=10, output_tokens=5, total_tokens=15),
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["runs", "get", "run_abc123"])

            assert result.exit_code == 0
            assert "run_abc123" in result.output
            assert "completed" in result.output

    def test_runs_get_not_found(self, runner):
        """Runs get shows error when run not found."""
        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get_run.side_effect = PlatformAPIError(404, "Run not found")
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["runs", "get", "run_nonexistent"])

            assert result.exit_code == 1
            assert "not found" in result.output.lower()

    def test_runs_get_json(self, runner):
        """Runs get with --json outputs JSON."""
        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get_run.return_value = _make_run_response(
                id="run_abc123", status="completed"
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["runs", "get", "run_abc123", "--json"])

            assert result.exit_code == 0
            data = json.loads(result.output)
            assert data["id"] == "run_abc123"
