"""Tests for MetricsCollector aggregation."""

from __future__ import annotations

from superserve_sdk.events import (
    MessageDeltaEvent,
    RunCompletedEvent,
    RunFailedEvent,
    ToolEndEvent,
    ToolStartEvent,
)
from superserve_sdk.metrics import MetricsCollector, RunMetrics, ToolMetrics
from superserve_sdk.models import UsageMetrics


class TestToolMetrics:
    """Tests for ToolMetrics dataclass."""

    def test_create_tool_metrics(self):
        """Test creating tool metrics."""
        metrics = ToolMetrics(
            name="Bash",
            tool_call_id="tc_123",
            input={"command": "ls"},
            output="file.txt",
            duration_ms=50,
            success=True,
        )

        assert metrics.name == "Bash"
        assert metrics.tool_call_id == "tc_123"
        assert metrics.input == {"command": "ls"}
        assert metrics.output == "file.txt"
        assert metrics.duration_ms == 50
        assert metrics.success is True

    def test_default_values(self):
        """Test default values."""
        metrics = ToolMetrics(
            name="Read",
            tool_call_id="tc_1",
            input={},
        )

        assert metrics.output == ""
        assert metrics.duration_ms == 0
        assert metrics.success is True
        assert metrics.started_at == 0.0
        assert metrics.ended_at == 0.0


class TestRunMetrics:
    """Tests for RunMetrics dataclass."""

    def test_create_run_metrics(self):
        """Test creating run metrics."""
        metrics = RunMetrics(
            run_id="run_123",
            input_tokens=100,
            output_tokens=50,
            total_tokens=150,
        )

        assert metrics.run_id == "run_123"
        assert metrics.input_tokens == 100
        assert metrics.output_tokens == 50
        assert metrics.total_tokens == 150

    def test_default_values(self):
        """Test default values."""
        metrics = RunMetrics(run_id="run_abc")

        assert metrics.input_tokens == 0
        assert metrics.output_tokens == 0
        assert metrics.total_tokens == 0
        assert metrics.turns == 0
        assert metrics.duration_ms == 0
        assert metrics.tools_used == []
        assert metrics.tool_calls == []
        assert metrics.content_chunks == 0
        assert metrics.total_content_length == 0
        assert metrics.started_at == 0.0
        assert metrics.ended_at == 0.0
        assert metrics.success is False
        assert metrics.error_message is None

    def test_wall_clock_duration(self):
        """Test wall_clock_duration_ms property."""
        metrics = RunMetrics(
            run_id="run_123",
            started_at=1000.0,
            ended_at=1002.5,
        )

        assert metrics.wall_clock_duration_ms == 2500

    def test_wall_clock_duration_not_started(self):
        """Test wall_clock_duration_ms when not started."""
        metrics = RunMetrics(run_id="run_123")

        assert metrics.wall_clock_duration_ms == 0

    def test_tool_call_count(self):
        """Test tool_call_count property."""
        metrics = RunMetrics(
            run_id="run_123",
            tool_calls=[
                ToolMetrics(name="Bash", tool_call_id="tc_1", input={}),
                ToolMetrics(name="Read", tool_call_id="tc_2", input={}),
            ],
        )

        assert metrics.tool_call_count == 2

    def test_average_tool_duration(self):
        """Test average_tool_duration_ms property."""
        metrics = RunMetrics(
            run_id="run_123",
            tool_calls=[
                ToolMetrics(name="Bash", tool_call_id="tc_1", input={}, duration_ms=100),
                ToolMetrics(name="Read", tool_call_id="tc_2", input={}, duration_ms=200),
            ],
        )

        assert metrics.average_tool_duration_ms == 150.0

    def test_average_tool_duration_no_tools(self):
        """Test average_tool_duration_ms with no tools."""
        metrics = RunMetrics(run_id="run_123")

        assert metrics.average_tool_duration_ms == 0.0

    def test_get_tool_calls_by_name(self):
        """Test get_tool_calls_by_name method."""
        metrics = RunMetrics(
            run_id="run_123",
            tool_calls=[
                ToolMetrics(name="Bash", tool_call_id="tc_1", input={}),
                ToolMetrics(name="Read", tool_call_id="tc_2", input={}),
                ToolMetrics(name="Bash", tool_call_id="tc_3", input={}),
            ],
        )

        bash_calls = metrics.get_tool_calls_by_name("Bash")

        assert len(bash_calls) == 2
        assert all(t.name == "Bash" for t in bash_calls)

    def test_get_tool_calls_by_name_not_found(self):
        """Test get_tool_calls_by_name with no matches."""
        metrics = RunMetrics(run_id="run_123")

        result = metrics.get_tool_calls_by_name("NonexistentTool")

        assert result == []


class TestMetricsCollector:
    """Tests for MetricsCollector class."""

    def test_init(self):
        """Test collector initialization."""
        collector = MetricsCollector("run_test")

        assert collector._run_id == "run_test"
        assert collector.metrics.run_id == "run_test"

    def test_process_message_delta(self):
        """Test processing message delta events."""
        collector = MetricsCollector("run_test")

        collector.process_event(MessageDeltaEvent(run_id="run_test", content="Hello"))
        collector.process_event(MessageDeltaEvent(run_id="run_test", content=" World"))

        metrics = collector.metrics
        assert metrics.content_chunks == 2
        assert metrics.total_content_length == 11  # "Hello World"
        assert metrics.started_at > 0

    def test_process_tool_start(self):
        """Test processing tool start events."""
        collector = MetricsCollector("run_test")

        collector.process_event(
            ToolStartEvent(
                run_id="run_test",
                tool="Bash",
                tool_call_id="tc_123",
                input={"command": "ls"},
            )
        )

        assert "tc_123" in collector._pending_tools
        assert collector._pending_tools["tc_123"].name == "Bash"

    def test_process_tool_end(self):
        """Test processing tool end events."""
        collector = MetricsCollector("run_test")

        # Start tool
        collector.process_event(
            ToolStartEvent(
                run_id="run_test",
                tool="Bash",
                tool_call_id="tc_123",
                input={"command": "ls"},
            )
        )

        # End tool
        collector.process_event(
            ToolEndEvent(
                run_id="run_test",
                tool="Bash",
                tool_call_id="tc_123",
                output="file.txt",
                duration_ms=100,
                success=True,
            )
        )

        metrics = collector.metrics
        assert len(metrics.tool_calls) == 1
        assert metrics.tool_calls[0].name == "Bash"
        assert metrics.tool_calls[0].output == "file.txt"
        assert metrics.tool_calls[0].duration_ms == 100
        assert "Bash" in metrics.tools_used
        assert "tc_123" not in collector._pending_tools

    def test_process_tool_end_without_start(self):
        """Test processing tool end without matching start."""
        collector = MetricsCollector("run_test")

        collector.process_event(
            ToolEndEvent(
                run_id="run_test",
                tool="Read",
                tool_call_id="tc_orphan",
                output="content",
                duration_ms=50,
                success=True,
            )
        )

        metrics = collector.metrics
        assert len(metrics.tool_calls) == 1
        assert metrics.tool_calls[0].name == "Read"

    def test_process_tool_match_by_name(self):
        """Test matching tool end to start by name when IDs don't match."""
        collector = MetricsCollector("run_test")

        # Start tool with one ID
        collector.process_event(
            ToolStartEvent(
                run_id="run_test",
                tool="Write",
                tool_call_id="tc_start",
                input={"path": "/test"},
            )
        )

        # End tool with different ID but same name
        collector.process_event(
            ToolEndEvent(
                run_id="run_test",
                tool="Write",
                tool_call_id="",  # Empty ID
                output="written",
                duration_ms=75,
                success=True,
            )
        )

        metrics = collector.metrics
        assert len(metrics.tool_calls) == 1
        assert metrics.tool_calls[0].input == {"path": "/test"}
        assert metrics.tool_calls[0].output == "written"

    def test_process_run_completed(self):
        """Test processing run completed event."""
        collector = MetricsCollector("run_test")

        usage = UsageMetrics(input_tokens=100, output_tokens=50, total_tokens=150)
        collector.process_event(
            RunCompletedEvent(
                run_id="run_test",
                output="Done",
                usage=usage,
                turns=3,
                duration_ms=5000,
                tools_used=["Bash", "Read"],
            )
        )

        metrics = collector.metrics
        assert metrics.success is True
        assert metrics.input_tokens == 100
        assert metrics.output_tokens == 50
        assert metrics.total_tokens == 150
        assert metrics.turns == 3
        assert metrics.duration_ms == 5000
        assert metrics.tools_used == ["Bash", "Read"]
        assert metrics.ended_at > 0

    def test_process_run_completed_without_usage(self):
        """Test processing run completed without usage metrics."""
        collector = MetricsCollector("run_test")

        collector.process_event(
            RunCompletedEvent(
                run_id="run_test",
                output="Done",
            )
        )

        metrics = collector.metrics
        assert metrics.success is True
        assert metrics.total_tokens == 0

    def test_process_run_failed(self):
        """Test processing run failed event."""
        collector = MetricsCollector("run_test")

        collector.process_event(
            RunFailedEvent(
                run_id="run_test",
                error={"code": "timeout", "message": "Agent timed out"},
            )
        )

        metrics = collector.metrics
        assert metrics.success is False
        assert metrics.error_message == "Agent timed out"
        assert metrics.ended_at > 0

    def test_process_run_started(self):
        """Test that run started event sets started_at."""
        collector = MetricsCollector("run_test")

        # Process message to set started_at
        collector.process_event(MessageDeltaEvent(run_id="run_test", content="Hi"))

        metrics = collector.metrics
        assert metrics.started_at > 0

    def test_full_event_sequence(self):
        """Test processing a full sequence of events."""
        collector = MetricsCollector("run_full")

        events = [
            MessageDeltaEvent(run_id="run_full", content="Starting"),
            ToolStartEvent(
                run_id="run_full",
                tool="Read",
                tool_call_id="tc_1",
                input={"path": "/file"},
            ),
            ToolEndEvent(
                run_id="run_full",
                tool="Read",
                tool_call_id="tc_1",
                output="content",
                duration_ms=50,
                success=True,
            ),
            MessageDeltaEvent(run_id="run_full", content=" Done"),
            RunCompletedEvent(
                run_id="run_full",
                output="Starting Done",
                usage=UsageMetrics(input_tokens=200, output_tokens=100, total_tokens=300),
                turns=2,
                duration_ms=3000,
                tools_used=["Read"],
            ),
        ]

        for event in events:
            collector.process_event(event)

        metrics = collector.metrics
        assert metrics.content_chunks == 2
        assert metrics.total_content_length == 13
        assert len(metrics.tool_calls) == 1
        assert metrics.total_tokens == 300
        assert metrics.success is True

    def test_reset(self):
        """Test resetting the collector."""
        collector = MetricsCollector("run_test")

        # Process some events
        collector.process_event(MessageDeltaEvent(run_id="run_test", content="Hi"))
        collector.process_event(
            ToolStartEvent(
                run_id="run_test",
                tool="Bash",
                tool_call_id="tc_1",
                input={},
            )
        )

        assert collector.metrics.content_chunks == 1
        assert len(collector._pending_tools) == 1

        # Reset
        collector.reset()

        assert collector.metrics.content_chunks == 0
        assert collector.metrics.run_id == "run_test"
        assert len(collector._pending_tools) == 0

    def test_metrics_property(self):
        """Test that metrics property returns current metrics."""
        collector = MetricsCollector("run_test")

        collector.process_event(MessageDeltaEvent(run_id="run_test", content="X"))

        metrics = collector.metrics

        assert isinstance(metrics, RunMetrics)
        assert metrics.content_chunks == 1

    def test_unique_tools_used(self):
        """Test that tools_used tracks unique tools."""
        collector = MetricsCollector("run_test")

        # Use same tool multiple times
        for i in range(3):
            collector.process_event(
                ToolStartEvent(
                    run_id="run_test",
                    tool="Bash",
                    tool_call_id=f"tc_{i}",
                    input={},
                )
            )
            collector.process_event(
                ToolEndEvent(
                    run_id="run_test",
                    tool="Bash",
                    tool_call_id=f"tc_{i}",
                    output="",
                    duration_ms=10,
                    success=True,
                )
            )

        metrics = collector.metrics
        assert len(metrics.tool_calls) == 3
        assert metrics.tools_used == ["Bash"]  # Only one entry

    def test_multiple_tools_tracking(self):
        """Test tracking multiple different tools."""
        collector = MetricsCollector("run_test")

        tools = ["Bash", "Read", "Write", "Glob"]
        for tool in tools:
            collector.process_event(
                ToolStartEvent(
                    run_id="run_test",
                    tool=tool,
                    tool_call_id=f"tc_{tool}",
                    input={},
                )
            )
            collector.process_event(
                ToolEndEvent(
                    run_id="run_test",
                    tool=tool,
                    tool_call_id=f"tc_{tool}",
                    output="",
                    duration_ms=10,
                    success=True,
                )
            )

        metrics = collector.metrics
        assert set(metrics.tools_used) == set(tools)
