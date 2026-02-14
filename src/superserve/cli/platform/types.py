"""Data types for Platform API contracts."""

from typing import Literal

from pydantic import BaseModel, Field


class Credentials(BaseModel):
    """Stored authentication credentials."""

    token: str
    token_type: str = "Bearer"
    expires_at: str | None = None
    refresh_token: str | None = None


class AgentManifest(BaseModel):
    """Metadata for a single agent in a project."""

    name: str
    route_prefix: str
    num_cpus: int | float
    num_gpus: int | float
    memory: str
    replicas: int
    pip: list[str] = Field(default_factory=list)


class MCPToolInfo(BaseModel):
    """Metadata for an MCP tool."""

    name: str
    description: str = ""


class MCPResourceInfo(BaseModel):
    """Metadata for an MCP resource."""

    name: str
    uri: str
    description: str = ""


class MCPServerManifest(BaseModel):
    """Metadata for a single MCP server in a project."""

    name: str
    route_prefix: str
    import_path: str = ""
    num_cpus: int | float
    num_gpus: int | float
    memory: str
    replicas: int
    pip: list[str] = Field(default_factory=list)
    tools: list[MCPToolInfo] = Field(default_factory=list)
    resources: list[MCPResourceInfo] = Field(default_factory=list)


class ProjectManifest(BaseModel):
    """Project package manifest."""

    version: str = "1.0"
    superserve_version: str = "0.1.0"
    name: str = ""
    agents: list[AgentManifest] = Field(default_factory=list)
    mcp_servers: list[MCPServerManifest] = Field(default_factory=list)
    python_version: str = ""
    created_at: str = ""
    checksum: str = ""


class ProjectResponse(BaseModel):
    """Response from project operations."""

    id: str
    name: str
    status: Literal[
        "pending",
        "building",
        "deploying",
        "running",
        "failed",
        "stopped",
        "starting",
        "unhealthy",
        "updating",
        "rolling_back",
    ]
    url: str | None = Field(None, alias="endpoint_url")
    agents: list[AgentManifest] = Field(default_factory=list)
    mcp_servers: list[MCPServerManifest] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    error: str | None = Field(None, alias="error_message")

    model_config = {"populate_by_name": True}


class DeviceCodeResponse(BaseModel):
    """OAuth device code response."""

    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


class LogEntry(BaseModel):
    """A single log entry."""

    timestamp: str
    level: str
    message: str
    agent: str | None = None


# ==================== HOSTED AGENTS ====================


class AgentResponse(BaseModel):
    """Response from agent API."""

    id: str
    name: str
    command: str | None = None
    environment_keys: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class UsageMetrics(BaseModel):
    """Token usage metrics."""

    input_tokens: int
    output_tokens: int
    total_tokens: int


class RunResponse(BaseModel):
    """Response from run API."""

    id: str
    agent_id: str
    agent_name: str | None = None
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
    prompt: str
    output: str | None = None
    error_message: str | None = None
    session_id: str | None = None
    usage: UsageMetrics | None = None
    turns: int = 0
    duration_ms: int = 0
    tools_used: list[str] = Field(default_factory=list)
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None


class RunEvent(BaseModel):
    """SSE event from run stream."""

    type: str
    data: dict


# ==================== SESSIONS ====================


class SessionResponse(BaseModel):
    """Session details from the API."""

    id: str
    agent_id: str
    title: str | None = None
    ephemeral: bool = False
    status: Literal["active", "idle", "completed", "failed"]
    sandbox_name: str | None = None
    message_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    idle_timeout_seconds: int = 1800
    created_at: str
    updated_at: str
    last_activity_at: str
    completed_at: str | None = None


class SessionEvent(BaseModel):
    """Session SSE event."""

    type: str
    data: dict
