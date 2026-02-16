"""Tests for superserve run CLI command and streaming."""

import json
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from superserve.cli.cli import cli
from superserve.cli.platform.client import PlatformAPIError, PlatformClient
from superserve.cli.platform.types import (
    RunEvent,
)


@pytest.fixture
def runner():
    """Provide a CLI runner."""
    return CliRunner()


def _mock_session_client(mock_client, events):
    """Configure a mock client for session-based streaming."""
    mock_client.create_session.return_value = {"id": "ses_test-session"}
    mock_client.stream_session_message.return_value = iter(events)


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
            _mock_session_client(mock_client, events)
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["run", "my-agent", "Hello"])

            assert result.exit_code == 0
            assert "Hello world!" in result.output
            mock_client.create_session.assert_called_once_with("my-agent")
            mock_client.stream_session_message.assert_called_once_with(
                "ses_test-session", "Hello"
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
            _mock_session_client(mock_client, events)
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
            _mock_session_client(mock_client, events)
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
            _mock_session_client(mock_client, events)
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
            _mock_session_client(mock_client, events)
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
            mock_client.create_session.side_effect = PlatformAPIError(
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
            mock_client.create_session.side_effect = PlatformAPIError(
                404, "Agent not found"
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["run", "nonexistent", "Hello"])

            assert result.exit_code == 1
            assert "not found" in result.output.lower()

    def test_run_completion_shows_duration(self):
        """Run command shows duration on completion."""
        stderr_runner = CliRunner()
        events = [
            RunEvent(type="message.delta", data={"content": "Answer"}),
            RunEvent(
                type="run.completed",
                data={
                    "run_id": "run_123",
                    "duration_ms": 5000,
                },
            ),
        ]

        with patch("superserve.cli.commands.run.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            _mock_session_client(mock_client, events)
            mock_client_cls.return_value = mock_client

            result = stderr_runner.invoke(cli, ["run", "my-agent", "Hello"])

            assert result.exit_code == 0
            assert "Completed in 5.0s" in result.output


# ==================== Unit Tests: Client SSE Parsing ====================


class TestClientSSEParsing:
    """Tests for PlatformClient._parse_sse_stream."""

    @staticmethod
    def _make_sse_chunks(events: list[tuple[str, dict]]) -> list[str]:
        """Build raw SSE text chunks from (event_type, data) tuples."""
        chunks = []
        for event_type, data in events:
            chunks.append(f"event: {event_type}\ndata: {json.dumps(data)}\n\n")
        return chunks

    @staticmethod
    def _make_sse_response(chunks: list[str]) -> MagicMock:
        """Build a mock response with iter_content returning SSE chunks."""
        mock_resp = MagicMock()
        mock_resp.iter_content.return_value = iter(chunks)
        mock_resp.headers = {}
        return mock_resp

    def test_parses_single_event(self):
        """Client parses a single SSE event."""
        client = PlatformClient(base_url="https://test.api.com")

        chunks = self._make_sse_chunks([("run.started", {"run_id": "run_123"})])
        mock_resp = self._make_sse_response(chunks)

        events = list(client._parse_sse_stream(mock_resp))

        assert len(events) == 1
        assert events[0].type == "run.started"
        assert events[0].data["run_id"] == "run_123"

    def test_parses_multiple_events(self):
        """Client parses multiple SSE events in sequence."""
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
        mock_resp = self._make_sse_response(chunks)

        events = list(client._parse_sse_stream(mock_resp))

        assert len(events) == 4
        assert events[0].type == "run.started"
        assert events[1].type == "message.delta"
        assert events[1].data["content"] == "Hello"
        assert events[2].data["content"] == " world"
        assert events[3].type == "run.completed"

    def test_parses_multiline_data(self):
        """Client handles multiline data fields per SSE spec."""
        client = PlatformClient(base_url="https://test.api.com")

        chunks = ['event: message.delta\ndata: {"content":\ndata: "hello"}\n\n']
        mock_resp = self._make_sse_response(chunks)

        events = list(client._parse_sse_stream(mock_resp))

        assert len(events) == 1
        assert events[0].data["content"] == "hello"

    def test_handles_malformed_json(self):
        """Client wraps malformed JSON in a raw field."""
        client = PlatformClient(base_url="https://test.api.com")

        chunks = [
            "event: message.delta\ndata: {invalid json}\n\n",
            'event: message.delta\ndata: {"content": "valid"}\n\n',
        ]
        mock_resp = self._make_sse_response(chunks)

        events = list(client._parse_sse_stream(mock_resp))

        assert len(events) == 2
        assert "raw" in events[0].data
        assert events[1].data["content"] == "valid"
