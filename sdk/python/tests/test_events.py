"""Tests for SSE event parsing."""

from __future__ import annotations

import pytest

from superserve_sdk.events import (
    BaseEvent,
    MessageDeltaEvent,
    RawEvent,
    RunCancelledEvent,
    RunCompletedEvent,
    RunFailedEvent,
    RunStartedEvent,
    ToolEndEvent,
    ToolStartEvent,
    parse_event,
)
from superserve_sdk.models import UsageMetrics


class TestRunStartedEvent:
    """Tests for RunStartedEvent."""

    def test_create_event(self):
        """Test creating a run started event."""
        event = RunStartedEvent(run_id="run_123")

        assert event.run_id == "run_123"
        assert event.type == "run.started"

    def test_parse_event(self):
        """Test parsing run started event."""
        event = parse_event("run.started", {"run_id": "run_456"})

        assert isinstance(event, RunStartedEvent)
        assert event.run_id == "run_456"


class TestMessageDeltaEvent:
    """Tests for MessageDeltaEvent."""

    def test_create_event(self):
        """Test creating a message delta event."""
        event = MessageDeltaEvent(run_id="run_123", content="Hello")

        assert event.run_id == "run_123"
        assert event.type == "message.delta"
        assert event.content == "Hello"

    def test_parse_event(self):
        """Test parsing message delta event."""
        event = parse_event(
            "message.delta",
            {
                "run_id": "run_456",
                "content": "World!",
            },
        )

        assert isinstance(event, MessageDeltaEvent)
        assert event.content == "World!"

    def test_empty_content(self):
        """Test message delta with empty content."""
        event = parse_event(
            "message.delta",
            {
                "run_id": "run_123",
                "content": "",
            },
        )

        assert event.content == ""

    def test_missing_content_defaults_to_empty(self):
        """Test that missing content defaults to empty string."""
        event = parse_event("message.delta", {"run_id": "run_123"})

        assert event.content == ""


class TestToolStartEvent:
    """Tests for ToolStartEvent."""

    def test_create_event(self):
        """Test creating a tool start event."""
        event = ToolStartEvent(
            run_id="run_123",
            tool="Bash",
            tool_call_id="tc_001",
            input={"command": "ls -la"},
        )

        assert event.run_id == "run_123"
        assert event.type == "tool.start"
        assert event.tool == "Bash"
        assert event.tool_call_id == "tc_001"
        assert event.input == {"command": "ls -la"}

    def test_parse_event(self):
        """Test parsing tool start event."""
        event = parse_event(
            "tool.start",
            {
                "run_id": "run_456",
                "tool": "Read",
                "tool_call_id": "tc_002",
                "input": {"file_path": "/test.txt"},
            },
        )

        assert isinstance(event, ToolStartEvent)
        assert event.tool == "Read"
        assert event.input == {"file_path": "/test.txt"}

    def test_default_values(self):
        """Test default values for optional fields."""
        event = ToolStartEvent(run_id="run_123", tool="Bash")

        assert event.tool_call_id == ""
        assert event.input == {}

    def test_parse_with_missing_fields(self):
        """Test parsing with missing optional fields."""
        event = parse_event(
            "tool.start",
            {
                "run_id": "run_123",
            },
        )

        assert event.tool == "unknown"
        assert event.tool_call_id == ""
        assert event.input == {}


class TestToolEndEvent:
    """Tests for ToolEndEvent."""

    def test_create_event(self):
        """Test creating a tool end event."""
        event = ToolEndEvent(
            run_id="run_123",
            tool="Bash",
            tool_call_id="tc_001",
            output="file1.txt\nfile2.txt",
            duration_ms=150,
            success=True,
        )

        assert event.run_id == "run_123"
        assert event.type == "tool.end"
        assert event.tool == "Bash"
        assert event.output == "file1.txt\nfile2.txt"
        assert event.duration_ms == 150
        assert event.success is True

    def test_parse_event(self):
        """Test parsing tool end event."""
        event = parse_event(
            "tool.end",
            {
                "run_id": "run_456",
                "tool": "Write",
                "tool_call_id": "tc_003",
                "output": "File written successfully",
                "duration_ms": 75,
                "success": True,
            },
        )

        assert isinstance(event, ToolEndEvent)
        assert event.tool == "Write"
        assert event.duration_ms == 75

    def test_failed_tool(self):
        """Test tool end event for failed tool."""
        event = ToolEndEvent(
            run_id="run_123",
            tool="Bash",
            output="Permission denied",
            success=False,
        )

        assert event.success is False

    def test_default_values(self):
        """Test default values."""
        event = ToolEndEvent(run_id="run_123", tool="Bash")

        assert event.tool_call_id == ""
        assert event.output == ""
        assert event.duration_ms == 0
        assert event.success is True


class TestRunCompletedEvent:
    """Tests for RunCompletedEvent."""

    def test_create_event(self):
        """Test creating a run completed event."""
        usage = UsageMetrics(input_tokens=100, output_tokens=50, total_tokens=150)
        event = RunCompletedEvent(
            run_id="run_123",
            output="Done!",
            usage=usage,
            turns=2,
            duration_ms=3000,
            tools_used=["Bash", "Read"],
        )

        assert event.run_id == "run_123"
        assert event.type == "run.completed"
        assert event.output == "Done!"
        assert event.usage is not None
        assert event.usage.total_tokens == 150
        assert event.turns == 2
        assert event.duration_ms == 3000
        assert event.tools_used == ["Bash", "Read"]

    def test_parse_event_with_usage(self):
        """Test parsing run completed event with usage."""
        event = parse_event(
            "run.completed",
            {
                "run_id": "run_456",
                "output": "Completed successfully",
                "usage": {
                    "input_tokens": 200,
                    "output_tokens": 100,
                    "total_tokens": 300,
                },
                "turns": 3,
                "duration_ms": 5000,
                "tools_used": ["Write"],
            },
        )

        assert isinstance(event, RunCompletedEvent)
        assert event.output == "Completed successfully"
        assert event.usage is not None
        assert event.usage.input_tokens == 200
        assert event.turns == 3

    def test_parse_event_without_usage(self):
        """Test parsing run completed event without usage."""
        event = parse_event(
            "run.completed",
            {
                "run_id": "run_789",
                "output": "Done",
            },
        )

        assert event.output == "Done"
        assert event.usage is None

    def test_default_values(self):
        """Test default values."""
        event = RunCompletedEvent(run_id="run_123")

        assert event.output == ""
        assert event.usage is None
        assert event.turns == 0
        assert event.duration_ms == 0
        assert event.tools_used == []


class TestRunFailedEvent:
    """Tests for RunFailedEvent."""

    def test_create_event(self):
        """Test creating a run failed event."""
        event = RunFailedEvent(
            run_id="run_123",
            error={"code": "timeout", "message": "Agent timed out"},
        )

        assert event.run_id == "run_123"
        assert event.type == "run.failed"
        assert event.error == {"code": "timeout", "message": "Agent timed out"}
        assert event.error_message == "Agent timed out"

    def test_parse_event(self):
        """Test parsing run failed event."""
        event = parse_event(
            "run.failed",
            {
                "run_id": "run_456",
                "error": {"code": "error", "message": "Something went wrong"},
            },
        )

        assert isinstance(event, RunFailedEvent)
        assert event.error_message == "Something went wrong"

    def test_error_message_property_missing_message(self):
        """Test error_message property when message is missing."""
        event = RunFailedEvent(run_id="run_123", error={"code": "unknown"})

        assert event.error_message == "Unknown error"

    def test_default_error(self):
        """Test default empty error."""
        event = RunFailedEvent(run_id="run_123")

        assert event.error == {}
        assert event.error_message == "Unknown error"


class TestRunCancelledEvent:
    """Tests for RunCancelledEvent."""

    def test_create_event(self):
        """Test creating a run cancelled event."""
        event = RunCancelledEvent(run_id="run_123")

        assert event.run_id == "run_123"
        assert event.type == "run.cancelled"

    def test_parse_event(self):
        """Test parsing run cancelled event."""
        event = parse_event("run.cancelled", {"run_id": "run_456"})

        assert isinstance(event, RunCancelledEvent)
        assert event.run_id == "run_456"


class TestParseEvent:
    """Tests for the parse_event function."""

    def test_all_event_types(self):
        """Test parsing all event types."""
        events = [
            ("run.started", {"run_id": "run_1"}, RunStartedEvent),
            ("message.delta", {"run_id": "run_1", "content": "Hi"}, MessageDeltaEvent),
            ("tool.start", {"run_id": "run_1", "tool": "Bash"}, ToolStartEvent),
            ("tool.end", {"run_id": "run_1", "tool": "Bash"}, ToolEndEvent),
            ("run.completed", {"run_id": "run_1", "output": "Done"}, RunCompletedEvent),
            ("run.failed", {"run_id": "run_1", "error": {}}, RunFailedEvent),
            ("run.cancelled", {"run_id": "run_1"}, RunCancelledEvent),
        ]

        for event_type, data, expected_class in events:
            event = parse_event(event_type, data)
            assert isinstance(event, expected_class)

    def test_unknown_event_type_raises_error(self):
        """Test that unknown event type raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            parse_event("unknown.event", {"run_id": "run_123"})

        assert "Unknown event type: unknown.event" in str(exc_info.value)

    def test_missing_run_id_defaults_to_empty(self):
        """Test that missing run_id defaults to empty string."""
        event = parse_event("run.started", {})

        assert event.run_id == ""


class TestRawEvent:
    """Tests for RawEvent."""

    def test_create_raw_event(self):
        """Test creating a raw event."""
        event = RawEvent(
            type="message.delta",
            data={"run_id": "run_123", "content": "Hello"},
        )

        assert event.type == "message.delta"
        assert event.data == {"run_id": "run_123", "content": "Hello"}

    def test_parse_raw_event(self):
        """Test parsing a raw event."""
        raw = RawEvent(
            type="message.delta",
            data={"run_id": "run_123", "content": "Test"},
        )
        event = raw.parse()

        assert isinstance(event, MessageDeltaEvent)
        assert event.content == "Test"

    def test_parse_all_types(self):
        """Test parsing raw events of all types."""
        raw_events = [
            RawEvent(type="run.started", data={"run_id": "run_1"}),
            RawEvent(type="message.delta", data={"run_id": "run_1", "content": "X"}),
            RawEvent(type="tool.start", data={"run_id": "run_1", "tool": "Read"}),
            RawEvent(type="tool.end", data={"run_id": "run_1", "tool": "Read"}),
            RawEvent(type="run.completed", data={"run_id": "run_1"}),
            RawEvent(type="run.failed", data={"run_id": "run_1"}),
            RawEvent(type="run.cancelled", data={"run_id": "run_1"}),
        ]

        expected_types = [
            RunStartedEvent,
            MessageDeltaEvent,
            ToolStartEvent,
            ToolEndEvent,
            RunCompletedEvent,
            RunFailedEvent,
            RunCancelledEvent,
        ]

        for raw, expected in zip(raw_events, expected_types, strict=False):
            parsed = raw.parse()
            assert isinstance(parsed, expected)

    def test_parse_unknown_raises_error(self):
        """Test that parsing unknown type raises ValueError."""
        raw = RawEvent(type="unknown.type", data={"run_id": "run_1"})

        with pytest.raises(ValueError):
            raw.parse()


class TestBaseEvent:
    """Tests for BaseEvent."""

    def test_base_event_is_abstract_like(self):
        """Test that BaseEvent can be instantiated but is meant as base."""
        event = BaseEvent(run_id="run_123")

        assert event.run_id == "run_123"

    def test_all_events_inherit_from_base(self):
        """Test that all event types inherit from BaseEvent."""
        event_classes = [
            RunStartedEvent,
            MessageDeltaEvent,
            ToolStartEvent,
            ToolEndEvent,
            RunCompletedEvent,
            RunFailedEvent,
            RunCancelledEvent,
        ]

        for cls in event_classes:
            assert issubclass(cls, BaseEvent)
