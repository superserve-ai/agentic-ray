"""Core types for the Superserve Python SDK."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field

from .errors import SandboxError


class SandboxStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    RESUMING = "resuming"
    FAILED = "failed"


class PreviewAccess(str, Enum):
    LEGACY_PUBLIC = "legacy_public"
    PUBLIC = "public"
    PRIVATE = "private"


PreviewAccessPolicy = Literal["public", "private"]


class NetworkConfig(BaseModel):
    allow_out: Optional[list[str]] = None
    deny_out: Optional[list[str]] = None


class SandboxSecretBinding(BaseModel):
    """One env-var → secret binding on a sandbox."""

    env_key: str
    secret_name: str
    # True when the underlying secret was deleted; the proxy token no longer resolves.
    revoked: Optional[bool] = None


class SandboxInfo(BaseModel):
    id: str
    name: str
    status: SandboxStatus
    vcpu_count: int = 0
    memory_mib: int = 0
    created_at: datetime
    timeout_seconds: Optional[int] = None
    # Delete the sandbox after it has been continuously paused for this many seconds.
    auto_delete_seconds: Optional[int] = None
    # When the sandbox will be auto-deleted. Set only while paused with auto_delete_seconds configured.
    auto_delete_at: Optional[datetime] = None
    network: Optional[NetworkConfig] = None
    metadata: dict[str, str] = Field(default_factory=dict)
    preview_access: PreviewAccess = PreviewAccess.LEGACY_PUBLIC
    # Secrets bound to this sandbox, when any are attached.
    secrets: Optional[list[SandboxSecretBinding]] = None


class PublishedPreviewPort(BaseModel):
    port: int
    token_version: int
    access: PreviewAccessPolicy


class PreviewPortList(BaseModel):
    preview_access: PreviewAccess
    ports: list[PublishedPreviewPort] = Field(default_factory=list)


class PreviewToken(BaseModel):
    token: str = Field(repr=False)
    port: int
    header: str
    query_param: str
    token_version: int
    access: PreviewAccessPolicy
    preview_access: PreviewAccess
    expires_at: Optional[datetime] = None


class CommandResult(BaseModel):
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0
    # True when the server dropped the tail of a non-streaming run's output
    # because combined stdout/stderr exceeded its retention cap (a notice is
    # also appended to stderr). Stream via on_stdout/on_stderr, or redirect to
    # a file inside the sandbox, for unbounded output. Always False for
    # streamed runs.
    truncated: bool = False


# Sentinel distinguishing "argument not provided" from an explicit None in
# update() kwargs, where None means "clear the setting" on the wire.
UNSET: Any = object()


def build_update_body(
    *,
    metadata: dict[str, str] | None,
    network: "NetworkConfig | None",
    auto_delete_seconds: int | None,
    timeout_seconds: int | None,
    preview_access: PreviewAccessPolicy | None,
) -> dict[str, Any]:
    """Serialize sandbox update args to the wire body. UNSET fields are omitted;
    an explicit None for auto_delete_seconds / timeout_seconds clears them."""
    body: dict[str, Any] = {}
    if metadata is not None:
        body["metadata"] = metadata
    if auto_delete_seconds is not UNSET:
        body["auto_delete_seconds"] = auto_delete_seconds
    if timeout_seconds is not UNSET:
        body["timeout_seconds"] = timeout_seconds
    if network is not None:
        body["network"] = {
            "allow_out": network.allow_out,
            "deny_out": network.deny_out,
        }
    if preview_access is not None:
        body["preview_access"] = preview_access
    return body


def _parse_iso8601(value: str) -> datetime:
    # datetime.fromisoformat rejects the RFC 3339 `Z` UTC designator on Python < 3.11.
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def to_sandbox_info(raw: dict[str, Any]) -> SandboxInfo:
    """Convert an API response dict to a SandboxInfo model."""
    if not raw.get("id"):
        raise SandboxError("Invalid API response: missing sandbox id")
    if not raw.get("status"):
        raise SandboxError("Invalid API response: missing sandbox status")
    if not raw.get("created_at"):
        raise SandboxError("Invalid API response: missing created_at")

    network = None
    if raw.get("network"):
        network = NetworkConfig(
            allow_out=raw["network"].get("allow_out"),
            deny_out=raw["network"].get("deny_out"),
        )

    secrets = None
    if raw.get("secrets"):
        secrets = [
            SandboxSecretBinding(
                env_key=s.get("env_key", ""),
                secret_name=s.get("secret_name", ""),
                revoked=s.get("revoked"),
            )
            for s in raw["secrets"]
        ]

    return SandboxInfo(
        id=raw["id"],
        name=raw.get("name", ""),
        status=SandboxStatus(raw["status"]),
        vcpu_count=raw.get("vcpu_count", 0),
        memory_mib=raw.get("memory_mib", 0),
        created_at=_parse_iso8601(raw["created_at"]),
        timeout_seconds=raw.get("timeout_seconds"),
        auto_delete_seconds=raw.get("auto_delete_seconds"),
        auto_delete_at=(
            _parse_iso8601(raw["auto_delete_at"]) if raw.get("auto_delete_at") else None
        ),
        network=network,
        metadata=raw.get("metadata", {}),
        preview_access=PreviewAccess(raw.get("preview_access", "legacy_public")),
        secrets=secrets,
    )


# ---------------------------------------------------------------------------
# Template
# ---------------------------------------------------------------------------


class TemplateStatus(str, Enum):
    PENDING = "pending"
    BUILDING = "building"
    READY = "ready"
    FAILED = "failed"


class TemplateBuildStatus(str, Enum):
    PENDING = "pending"
    BUILDING = "building"
    SNAPSHOTTING = "snapshotting"
    READY = "ready"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BuildLogStream(str, Enum):
    STDOUT = "stdout"
    STDERR = "stderr"
    SYSTEM = "system"


class TemplateInfo(BaseModel):
    id: str
    name: str
    team_id: str
    status: TemplateStatus
    vcpu: int = 0
    memory_mib: int = 0
    disk_mib: int = 0
    size_bytes: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime
    built_at: Optional[datetime] = None
    latest_build_id: Optional[str] = None


class TemplateBuildInfo(BaseModel):
    id: str
    template_id: str
    status: TemplateBuildStatus
    build_spec_hash: str
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    finalized_at: Optional[datetime] = None
    created_at: datetime


class BuildLogEvent(BaseModel):
    timestamp: datetime
    stream: BuildLogStream
    text: str = ""
    finished: Optional[bool] = None
    status: Optional[str] = None  # "ready" | "failed" | "cancelled" when finished


# BuildStep discriminated union (mutually exclusive fields)
class RunStep(BaseModel):
    run: str


class EnvStepValue(BaseModel):
    key: str
    value: str


class EnvStep(BaseModel):
    env: EnvStepValue


class WorkdirStep(BaseModel):
    workdir: str


class UserStepValue(BaseModel):
    name: str
    sudo: bool = False


class UserStep(BaseModel):
    user: UserStepValue


BuildStep = Union[RunStep, EnvStep, WorkdirStep, UserStep]


# ---------------------------------------------------------------------------
# Template converters
# ---------------------------------------------------------------------------


def to_template_info(
    raw: dict[str, Any],
    latest_build_id: Optional[str] = None,
) -> TemplateInfo:
    if not raw.get("id"):
        raise SandboxError("Invalid API response: missing template id")
    if not raw.get("name"):
        raise SandboxError("Invalid API response: missing template name")
    if not raw.get("status"):
        raise SandboxError("Invalid API response: missing template status")
    if not raw.get("team_id"):
        raise SandboxError("Invalid API response: missing team_id")
    if not raw.get("created_at"):
        raise SandboxError("Invalid API response: missing created_at")

    return TemplateInfo(
        id=raw["id"],
        name=raw["name"],
        team_id=raw["team_id"],
        status=TemplateStatus(raw["status"]),
        vcpu=raw.get("vcpu", 0),
        memory_mib=raw.get("memory_mib", 0),
        disk_mib=raw.get("disk_mib", 0),
        size_bytes=raw.get("size_bytes"),
        error_message=raw.get("error_message"),
        created_at=_parse_iso8601(raw["created_at"]),
        built_at=_parse_iso8601(raw["built_at"]) if raw.get("built_at") else None,
        latest_build_id=latest_build_id or raw.get("latest_build_id"),
    )


def to_template_build_info(raw: dict[str, Any]) -> TemplateBuildInfo:
    if not raw.get("id"):
        raise SandboxError("Invalid API response: missing build id")
    if not raw.get("template_id"):
        raise SandboxError("Invalid API response: missing template_id")
    if not raw.get("status"):
        raise SandboxError("Invalid API response: missing build status")
    if not raw.get("build_spec_hash"):
        raise SandboxError("Invalid API response: missing build_spec_hash")
    if not raw.get("created_at"):
        raise SandboxError("Invalid API response: missing created_at")

    return TemplateBuildInfo(
        id=raw["id"],
        template_id=raw["template_id"],
        status=TemplateBuildStatus(raw["status"]),
        build_spec_hash=raw["build_spec_hash"],
        error_message=raw.get("error_message"),
        started_at=_parse_iso8601(raw["started_at"]) if raw.get("started_at") else None,
        finalized_at=_parse_iso8601(raw["finalized_at"])
        if raw.get("finalized_at")
        else None,
        created_at=_parse_iso8601(raw["created_at"]),
    )


def to_build_log_event(raw: dict[str, Any]) -> BuildLogEvent:
    if not raw.get("timestamp"):
        raise SandboxError("Invalid log event: missing timestamp")
    if not raw.get("stream"):
        raise SandboxError("Invalid log event: missing stream")

    return BuildLogEvent(
        timestamp=_parse_iso8601(raw["timestamp"]),
        stream=BuildLogStream(raw["stream"]),
        text=raw.get("text", ""),
        finished=raw.get("finished"),
        status=raw.get("status"),
    )


def build_steps_to_api(steps: list[BuildStep]) -> list[dict[str, Any]]:
    """Serialize BuildStep pydantic models to API dict format."""
    return [s.model_dump() for s in steps]


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------


class SecretAuthType(str, Enum):
    BEARER = "bearer"
    BASIC = "basic"
    API_KEY = "api-key"
    CUSTOM = "custom"
    PER_HOST = "per_host"


class SecretInfo(BaseModel):
    id: str
    name: str
    auth_type: SecretAuthType
    auth_config: dict[str, Any] = Field(default_factory=dict)
    # Set when created from a provider shortcut (e.g. "anthropic").
    provider_shortcut: Optional[str] = None
    hosts: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    last_used_at: Optional[datetime] = None


class ProxyAuditEvent(BaseModel):
    """One request made with a secret attached (``Secret.get_audit``)."""

    id: int
    ts: datetime
    sandbox_id: str
    # Null when the referenced sandbox has been deleted.
    sandbox_name: Optional[str] = None
    secret_id: Optional[str] = None
    method: str = ""
    host: str = ""
    path: str = ""
    status: int = 0
    upstream_status: Optional[int] = None
    latency_ms: Optional[int] = None
    error_code: Optional[str] = None


class SecretSandboxBinding(BaseModel):
    """A sandbox a secret is bound to (``Secret.get_sandboxes``)."""

    sandbox_id: str
    sandbox_name: str
    env_key: str
    status: SandboxStatus


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------


class ProviderShortcut(BaseModel):
    """A built-in provider shortcut (``Provider.list``)."""

    name: str
    display: str
    auth_type: SecretAuthType
    auth_config: dict[str, Any] = Field(default_factory=dict)
    hosts: list[str] = Field(default_factory=list)
    # Prefix-shaped sample of the proxy token issued (e.g. "sk-ant-api03-...").
    token_shape: str = ""


# ---------------------------------------------------------------------------
# Network log
# ---------------------------------------------------------------------------


class NetworkVerdict(str, Enum):
    ALLOWED = "allowed"
    BLOCKED = "blocked"
    FAILED = "failed"


class NetworkEvent(BaseModel):
    """One row in a sandbox's network log.

    ``kind`` selects which fields are present: ``connection`` rows carry
    ``dst_ip``/``verdict``/byte counts; ``request`` rows carry
    ``method``/``path``/``status`` and the ``secret_id`` injected.
    """

    kind: str  # "connection" | "request"
    id: int
    ts: datetime
    host: Optional[str] = None

    # connection
    dst_ip: Optional[str] = None
    dst_port: Optional[int] = None
    verdict: Optional[NetworkVerdict] = None
    match_rule: Optional[str] = None
    bytes_sent: Optional[int] = None
    bytes_recv: Optional[int] = None

    # request
    method: Optional[str] = None
    path: Optional[str] = None
    status: Optional[int] = None
    upstream_status: Optional[int] = None
    latency_ms: Optional[int] = None
    secret_id: Optional[str] = None
    error_code: Optional[str] = None


class NetworkLogPage(BaseModel):
    """A page of network events plus its pagination cursor."""

    events: list[NetworkEvent] = Field(default_factory=list)
    # Pass as ``before`` to fetch the next page; None when ``has_more`` is False.
    next_cursor: Optional[str] = None
    has_more: bool = False


# ---------------------------------------------------------------------------
# Secrets / Providers / Network converters
# ---------------------------------------------------------------------------


def to_secret_info(raw: dict[str, Any]) -> SecretInfo:
    if not raw.get("id"):
        raise SandboxError("Invalid API response: missing secret id")
    if not raw.get("name"):
        raise SandboxError("Invalid API response: missing secret name")
    if not raw.get("auth_type"):
        raise SandboxError("Invalid API response: missing auth_type")
    if not raw.get("created_at"):
        raise SandboxError("Invalid API response: missing created_at")

    return SecretInfo(
        id=raw["id"],
        name=raw["name"],
        auth_type=SecretAuthType(raw["auth_type"]),
        auth_config=raw.get("auth_config") or {},
        provider_shortcut=raw.get("provider_shortcut"),
        hosts=raw.get("hosts") or [],
        created_at=_parse_iso8601(raw["created_at"]),
        updated_at=_parse_iso8601(raw.get("updated_at") or raw["created_at"]),
        last_used_at=_parse_iso8601(raw["last_used_at"])
        if raw.get("last_used_at")
        else None,
    )


def to_provider_shortcut(raw: dict[str, Any]) -> ProviderShortcut:
    if not raw.get("name"):
        raise SandboxError("Invalid API response: missing provider name")
    return ProviderShortcut(
        name=raw["name"],
        display=raw.get("display") or raw["name"],
        auth_type=SecretAuthType(raw.get("auth_type") or "bearer"),
        auth_config=raw.get("auth_config") or {},
        hosts=raw.get("hosts") or [],
        token_shape=raw.get("token_shape") or "",
    )


def to_proxy_audit_event(raw: dict[str, Any]) -> ProxyAuditEvent:
    if raw.get("id") is None:
        raise SandboxError("Invalid audit event: missing id")
    if not raw.get("ts"):
        raise SandboxError("Invalid audit event: missing ts")
    return ProxyAuditEvent(
        id=raw["id"],
        ts=_parse_iso8601(raw["ts"]),
        sandbox_id=raw.get("sandbox_id") or "",
        sandbox_name=raw.get("sandbox_name"),
        secret_id=raw.get("secret_id"),
        method=raw.get("method") or "",
        host=raw.get("host") or "",
        path=raw.get("path") or "",
        status=raw.get("status") or 0,
        upstream_status=raw.get("upstream_status"),
        latency_ms=raw.get("latency_ms"),
        error_code=raw.get("error_code"),
    )


def to_secret_sandbox_binding(raw: dict[str, Any]) -> SecretSandboxBinding:
    return SecretSandboxBinding(
        sandbox_id=raw.get("sandbox_id") or "",
        sandbox_name=raw.get("sandbox_name") or "",
        env_key=raw.get("env_key") or "",
        status=SandboxStatus(raw.get("status") or "active"),
    )


def to_network_event(raw: dict[str, Any]) -> NetworkEvent:
    if raw.get("id") is None:
        raise SandboxError("Invalid network event: missing id")
    if not raw.get("kind"):
        raise SandboxError("Invalid network event: missing kind")
    if not raw.get("ts"):
        raise SandboxError("Invalid network event: missing ts")
    return NetworkEvent(
        kind=raw["kind"],
        id=raw["id"],
        ts=_parse_iso8601(raw["ts"]),
        host=raw.get("host"),
        dst_ip=raw.get("dst_ip"),
        dst_port=raw.get("dst_port"),
        verdict=NetworkVerdict(raw["verdict"]) if raw.get("verdict") else None,
        match_rule=raw.get("match_rule"),
        bytes_sent=raw.get("bytes_sent"),
        bytes_recv=raw.get("bytes_recv"),
        method=raw.get("method"),
        path=raw.get("path"),
        status=raw.get("status"),
        upstream_status=raw.get("upstream_status"),
        latency_ms=raw.get("latency_ms"),
        secret_id=raw.get("secret_id"),
        error_code=raw.get("error_code"),
    )


def to_network_log_page(raw: dict[str, Any]) -> NetworkLogPage:
    return NetworkLogPage(
        events=[to_network_event(e) for e in (raw.get("data") or [])],
        next_cursor=raw.get("next_cursor"),
        has_more=raw.get("has_more") or False,
    )
