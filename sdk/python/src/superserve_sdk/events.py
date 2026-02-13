"""SSE event types for streaming run events."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .models import UsageMetrics


class BaseEvent(BaseModel):
    """Base class for all SSE events."""

    run_id: str = Field(..., description="Run ID")


class RunStartedEvent(BaseEvent):
    """Event emitted when a run starts executing."""

    type: str = Field(default="run.started", description="Event type")


class MessageDeltaEvent(BaseEvent):
    """Event emitted when the agent outputs a text chunk."""

    type: str = Field(default="message.delta", description="Event type")
    content: str = Field(..., description="Text content chunk")


class ToolStartEvent(BaseEvent):
    """Event emitted when a tool execution begins."""

    type: str = Field(default="tool.start", description="Event type")
    tool: str = Field(..., description="Tool name")
    tool_call_id: str = Field(default="", description="Unique tool call ID")
    input: dict[str, Any] = Field(default_factory=dict, description="Tool input parameters")


class ToolEndEvent(BaseEvent):
    """Event emitted when a tool execution completes."""

    type: str = Field(default="tool.end", description="Event type")
    tool: str = Field(..., description="Tool name")
    tool_call_id: str = Field(default="", description="Unique tool call ID")
    output: str = Field(default="", description="Tool output")
    duration_ms: int = Field(default=0, description="Tool execution duration in ms")
    success: bool = Field(default=True, description="Whether tool succeeded")


class RunCompletedEvent(BaseEvent):
    """Event emitted when a run completes successfully."""

    type: str = Field(default="run.completed", description="Event type")
    output: str = Field(default="", description="Final run output")
    usage: UsageMetrics | None = Field(None, description="Token usage metrics")
    turns: int = Field(default=0, description="Number of turns executed")
    duration_ms: int = Field(default=0, description="Total run duration in ms")
    tools_used: list[str] = Field(default_factory=list, description="Tools used")


class RunFailedEvent(BaseEvent):
    """Event emitted when a run fails."""

    type: str = Field(default="run.failed", description="Event type")
    error: dict[str, Any] = Field(default_factory=dict, description="Error details")

    @property
    def error_message(self) -> str:
        """Get the error message."""
        return self.error.get("message", "Unknown error")


class RunCancelledEvent(BaseEvent):
    """Event emitted when a run is cancelled."""

    type: str = Field(default="run.cancelled", description="Event type")


# Type alias for all event types
RunEvent = (
    RunStartedEvent
    | MessageDeltaEvent
    | ToolStartEvent
    | ToolEndEvent
    | RunCompletedEvent
    | RunFailedEvent
    | RunCancelledEvent
)


def parse_event(event_type: str, data: dict[str, Any]) -> RunEvent:
    """Parse an SSE event into the appropriate event type.

    Args:
        event_type: The SSE event type string.
        data: The parsed JSON data from the SSE event.

    Returns:
        The appropriate event object.

    Raises:
        ValueError: If the event type is unknown.
    """
    run_id = data.get("run_id", "")

    if event_type == "run.started":
        return RunStartedEvent(run_id=run_id)

    elif event_type == "message.delta":
        return MessageDeltaEvent(
            run_id=run_id,
            content=data.get("content", ""),
        )

    elif event_type == "tool.start":
        return ToolStartEvent(
            run_id=run_id,
            tool=data.get("tool", "unknown"),
            tool_call_id=data.get("tool_call_id", ""),
            input=data.get("input", {}),
        )

    elif event_type == "tool.end":
        return ToolEndEvent(
            run_id=run_id,
            tool=data.get("tool", "unknown"),
            tool_call_id=data.get("tool_call_id", ""),
            output=data.get("output", ""),
            duration_ms=data.get("duration_ms", 0),
            success=data.get("success", True),
        )

    elif event_type == "run.completed":
        usage_data = data.get("usage")
        usage = None
        if usage_data:
            usage = UsageMetrics(
                input_tokens=usage_data.get("input_tokens", 0),
                output_tokens=usage_data.get("output_tokens", 0),
                total_tokens=usage_data.get("total_tokens", 0),
            )
        return RunCompletedEvent(
            run_id=run_id,
            output=data.get("output", ""),
            usage=usage,
            turns=data.get("turns", 0),
            duration_ms=data.get("duration_ms", 0),
            tools_used=data.get("tools_used", []),
        )

    elif event_type == "run.failed":
        return RunFailedEvent(
            run_id=run_id,
            error=data.get("error", {}),
        )

    elif event_type == "run.cancelled":
        return RunCancelledEvent(run_id=run_id)

    else:
        # Return a generic event for unknown types
        raise ValueError(f"Unknown event type: {event_type}")


class RawEvent(BaseModel):
    """Raw SSE event before parsing into typed events."""

    type: str = Field(..., description="Event type")
    data: dict[str, Any] = Field(default_factory=dict, description="Event data")

    def parse(self) -> RunEvent:
        """Parse this raw event into a typed event."""
        return parse_event(self.type, self.data)
