"""Metrics collection for tracking run performance."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from .events import (
    MessageDeltaEvent,
    RunCompletedEvent,
    RunEvent,
    RunFailedEvent,
    ToolEndEvent,
    ToolStartEvent,
)


@dataclass
class ToolMetrics:
    """Metrics for a single tool execution."""

    name: str
    tool_call_id: str
    input: dict[str, Any]
    output: str = ""
    duration_ms: int = 0
    success: bool = True
    started_at: float = 0.0
    ended_at: float = 0.0


@dataclass
class RunMetrics:
    """Aggregated metrics for a complete run."""

    run_id: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    turns: int = 0
    duration_ms: int = 0
    tools_used: list[str] = field(default_factory=list)
    tool_calls: list[ToolMetrics] = field(default_factory=list)
    content_chunks: int = 0
    total_content_length: int = 0
    started_at: float = 0.0
    ended_at: float = 0.0
    success: bool = False
    error_message: str | None = None

    @property
    def wall_clock_duration_ms(self) -> int:
        """Calculate wall clock duration in milliseconds."""
        if self.started_at and self.ended_at:
            return int((self.ended_at - self.started_at) * 1000)
        return 0

    @property
    def tool_call_count(self) -> int:
        """Get the total number of tool calls."""
        return len(self.tool_calls)

    @property
    def average_tool_duration_ms(self) -> float:
        """Get the average tool execution duration in ms."""
        if not self.tool_calls:
            return 0.0
        total = sum(t.duration_ms for t in self.tool_calls)
        return total / len(self.tool_calls)

    def get_tool_calls_by_name(self, name: str) -> list[ToolMetrics]:
        """Get all tool calls for a specific tool."""
        return [t for t in self.tool_calls if t.name == name]


class MetricsCollector:
    """Collector for tracking run metrics from SSE events."""

    def __init__(self, run_id: str) -> None:
        """Initialize the metrics collector.

        Args:
            run_id: The run ID to track metrics for.
        """
        self._run_id = run_id
        self._metrics = RunMetrics(run_id=run_id)
        self._pending_tools: dict[str, ToolMetrics] = {}

    @property
    def metrics(self) -> RunMetrics:
        """Get the current metrics."""
        return self._metrics

    def process_event(self, event: RunEvent) -> None:
        """Process an SSE event and update metrics.

        Args:
            event: The SSE event to process.
        """
        if isinstance(event, MessageDeltaEvent):
            self._handle_message_delta(event)
        elif isinstance(event, ToolStartEvent):
            self._handle_tool_start(event)
        elif isinstance(event, ToolEndEvent):
            self._handle_tool_end(event)
        elif isinstance(event, RunCompletedEvent):
            self._handle_run_completed(event)
        elif isinstance(event, RunFailedEvent):
            self._handle_run_failed(event)

    def _handle_message_delta(self, event: MessageDeltaEvent) -> None:
        """Handle a message delta event."""
        self._metrics.content_chunks += 1
        self._metrics.total_content_length += len(event.content)

        # Set started_at on first content
        if self._metrics.started_at == 0.0:
            self._metrics.started_at = time.time()

    def _handle_tool_start(self, event: ToolStartEvent) -> None:
        """Handle a tool start event."""
        tool_id = event.tool_call_id or f"{event.tool}_{time.time()}"
        self._pending_tools[tool_id] = ToolMetrics(
            name=event.tool,
            tool_call_id=event.tool_call_id,
            input=event.input,
            started_at=time.time(),
        )

        # Set started_at on first tool if not set
        if self._metrics.started_at == 0.0:
            self._metrics.started_at = time.time()

    def _handle_tool_end(self, event: ToolEndEvent) -> None:
        """Handle a tool end event."""
        # Find matching pending tool
        tool_metrics = None
        for pending_id, pending in list(self._pending_tools.items()):
            if event.tool_call_id and pending_id == event.tool_call_id:
                tool_metrics = pending
                del self._pending_tools[pending_id]
                break
            elif pending.name == event.tool:
                tool_metrics = pending
                del self._pending_tools[pending_id]
                break

        if tool_metrics is None:
            # Create new tool metrics if no pending found
            tool_metrics = ToolMetrics(
                name=event.tool,
                tool_call_id=event.tool_call_id,
                input={},
                started_at=time.time(),
            )

        tool_metrics.output = event.output
        tool_metrics.duration_ms = event.duration_ms
        tool_metrics.success = event.success
        tool_metrics.ended_at = time.time()

        self._metrics.tool_calls.append(tool_metrics)

        # Track unique tools used
        if event.tool not in self._metrics.tools_used:
            self._metrics.tools_used.append(event.tool)

    def _handle_run_completed(self, event: RunCompletedEvent) -> None:
        """Handle a run completed event."""
        self._metrics.ended_at = time.time()
        self._metrics.success = True

        if event.usage:
            self._metrics.input_tokens = event.usage.input_tokens
            self._metrics.output_tokens = event.usage.output_tokens
            self._metrics.total_tokens = event.usage.total_tokens

        self._metrics.turns = event.turns
        self._metrics.duration_ms = event.duration_ms
        self._metrics.tools_used = event.tools_used or self._metrics.tools_used

    def _handle_run_failed(self, event: RunFailedEvent) -> None:
        """Handle a run failed event."""
        self._metrics.ended_at = time.time()
        self._metrics.success = False
        self._metrics.error_message = event.error_message

    def reset(self) -> None:
        """Reset the collector to initial state."""
        self._metrics = RunMetrics(run_id=self._run_id)
        self._pending_tools.clear()
