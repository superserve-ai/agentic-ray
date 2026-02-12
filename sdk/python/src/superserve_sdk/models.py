"""Pydantic models for Superserve SDK."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .constants import DEFAULT_MODEL


class AgentConfig(BaseModel):
    """Configuration for creating or updating an agent."""

    name: str = Field(..., min_length=1, max_length=63, description="Agent name")
    model: str = Field(
        default=DEFAULT_MODEL,
        description="Model to use for the agent",
    )
    system_prompt: str = Field(
        default="You are a helpful assistant.", description="System prompt for the agent"
    )
    tools: list[str] = Field(
        default_factory=lambda: ["Bash", "Read", "Write", "Glob", "Grep"],
        description="List of tools the agent can use",
    )
    max_turns: int = Field(
        default=10,
        ge=1,
        le=100,
        description="Maximum number of conversation turns",
    )
    timeout_seconds: int = Field(
        default=300,
        ge=10,
        le=3600,
        description="Timeout in seconds for the agent",
    )


class Agent(BaseModel):
    """Agent resource returned from the API."""

    id: str = Field(..., description="Agent ID with agt_ prefix")
    name: str = Field(..., description="Agent name")
    model: str = Field(..., description="Model used by the agent")
    system_prompt: str = Field(..., description="System prompt")
    tools: list[str] = Field(default_factory=list, description="Available tools")
    max_turns: int = Field(..., description="Maximum conversation turns")
    timeout_seconds: int = Field(..., description="Timeout in seconds")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")


class UsageMetrics(BaseModel):
    """Token usage metrics for a run."""

    input_tokens: int = Field(..., description="Number of input tokens")
    output_tokens: int = Field(..., description="Number of output tokens")
    total_tokens: int = Field(..., description="Total tokens (input + output)")


class Run(BaseModel):
    """Run resource returned from the API."""

    id: str = Field(..., description="Run ID with run_ prefix")
    agent_id: str = Field(..., description="Agent ID")
    agent_name: str | None = Field(None, description="Human-readable agent name")
    status: Literal["pending", "running", "completed", "failed", "cancelled"] = Field(
        ..., description="Run status"
    )
    prompt: str = Field(..., description="User prompt")
    output: str | None = Field(None, description="Run output (when completed)")
    error_message: str | None = Field(None, description="Error message (when failed)")
    session_id: str | None = Field(None, description="Session ID for multi-turn")
    usage: UsageMetrics | None = Field(None, description="Token usage metrics")
    turns: int = Field(default=0, description="Number of turns executed")
    duration_ms: int = Field(default=0, description="Duration in milliseconds")
    tools_used: list[str] = Field(default_factory=list, description="Tools used in run")
    created_at: datetime = Field(..., description="Creation timestamp")
    started_at: datetime | None = Field(None, description="Start timestamp")
    completed_at: datetime | None = Field(None, description="Completion timestamp")


class AgentUpdateConfig(BaseModel):
    """Configuration for updating an agent (all fields optional)."""

    model: str | None = Field(None, description="Model to use for the agent")
    system_prompt: str | None = Field(None, description="System prompt for the agent")
    tools: list[str] | None = Field(None, description="List of tools the agent can use")
    max_turns: int | None = Field(
        None,
        ge=1,
        le=100,
        description="Maximum number of conversation turns",
    )
    timeout_seconds: int | None = Field(
        None,
        ge=10,
        le=3600,
        description="Timeout in seconds for the agent",
    )


class RunCreateRequest(BaseModel):
    """Request to create a new run."""

    agent_id: str = Field(..., description="Agent ID or name")
    prompt: str = Field(..., min_length=1, max_length=100000, description="User prompt")
    session_id: str | None = Field(None, description="Session ID for multi-turn")
