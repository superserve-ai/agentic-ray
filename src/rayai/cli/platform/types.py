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
    """Metadata for a single agent in a deployment."""

    name: str
    route_prefix: str
    num_cpus: int | float
    num_gpus: int | float
    memory: str
    replicas: int
    pip: list[str] = Field(default_factory=list)


class DeploymentManifest(BaseModel):
    """Deployment package manifest."""

    version: str = "1.0"
    rayai_version: str = "0.1.0"
    name: str = ""
    agents: list[AgentManifest] = Field(default_factory=list)
    python_version: str = ""
    created_at: str = ""
    checksum: str = ""


class DeploymentResponse(BaseModel):
    """Response from deployment operations."""

    id: str
    name: str
    status: Literal["pending", "building", "deploying", "running", "failed", "stopped"]
    url: str | None = Field(None, alias="endpoint_url")
    agents: list[AgentManifest] = Field(default_factory=list)
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
