"""HTTP client for Superserve Platform API."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any, TypeVar, cast

import requests
from pydantic import BaseModel, ValidationError

from .auth import get_credentials
from .config import DEFAULT_TIMEOUT, PLATFORM_API_URL, USER_AGENT
from .types import (
    AgentResponse,
    Credentials,
    DeviceCodeResponse,
    RunEvent,
)


class PlatformAPIError(Exception):
    """Platform API error with status code and message."""

    def __init__(
        self, status_code: int, message: str, details: dict | None = None
    ) -> None:
        self.status_code = status_code
        self.message = message
        self.details = details or {}
        super().__init__(f"[{status_code}] {message}")


class PlatformClient:
    """HTTP client for Superserve Platform API."""

    def __init__(
        self, base_url: str = PLATFORM_API_URL, timeout: int = DEFAULT_TIMEOUT
    ) -> None:
        """Initialize the Platform API client.

        Args:
            base_url: Base URL for the Platform API.
            timeout: Request timeout in seconds.
        """
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()
        # Cache for agent name -> ID resolution to avoid repeated API calls
        self._agent_name_cache: dict[str, str] = {}

    def _get_headers(self, authenticated: bool = True) -> dict[str, str]:
        """Get request headers.

        Args:
            authenticated: Whether to include auth header.

        Returns:
            Headers dictionary.

        Raises:
            PlatformAPIError: If authenticated=True but no credentials found.
        """
        headers = {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
        }
        if authenticated:
            creds = get_credentials()
            if not creds:
                raise PlatformAPIError(
                    401, "Not authenticated. Run 'superserve login' first."
                )
            headers["Authorization"] = f"Bearer {creds.token}"
        return headers

    def _request(
        self,
        method: str,
        endpoint: str,
        json_data: dict | None = None,
        files: dict | None = None,
        data: dict | None = None,
        params: dict | None = None,
        stream: bool = False,
        authenticated: bool = True,
    ) -> requests.Response:
        """Make request to Platform API.

        Args:
            method: HTTP method.
            endpoint: API endpoint (without /v1 prefix).
            json_data: JSON body data.
            files: Files for multipart upload.
            data: Form data for multipart upload.
            params: URL query parameters.
            stream: Whether to stream response.
            authenticated: Whether to include auth header.

        Returns:
            Response object.

        Raises:
            PlatformAPIError: On API errors or connection issues.
        """
        url = f"{self.base_url}/v1{endpoint}"
        headers = self._get_headers(authenticated)

        # Remove Content-Type for multipart uploads
        if files:
            headers.pop("Content-Type", None)

        try:
            response = self._session.request(
                method,
                url,
                headers=headers,
                json=json_data,
                files=files,
                data=data,
                params=params,
                stream=stream,
                timeout=None if stream else self.timeout,
            )

            if response.status_code >= 400:
                try:
                    error_data = response.json() if response.content else {}
                except json.JSONDecodeError:
                    error_data = {}
                detail = error_data.get("detail") or error_data.get("message")
                # FastAPI may return detail as a list/dict for validation errors
                if detail and not isinstance(detail, str):
                    detail = json.dumps(detail)
                raise PlatformAPIError(
                    response.status_code,
                    detail or response.reason,
                    error_data.get("details"),
                )
            return response

        except requests.exceptions.ConnectionError as e:
            raise PlatformAPIError(0, "Cannot connect to Superserve API") from e
        except requests.exceptions.Timeout as e:
            raise PlatformAPIError(0, "Request timed out") from e
        except requests.exceptions.RequestException as e:
            raise PlatformAPIError(0, "Network request failed") from e

    @staticmethod
    def _safe_json(resp: requests.Response) -> Any:
        """Parse JSON from response, raising PlatformAPIError on failure."""
        try:
            return resp.json()
        except (json.JSONDecodeError, ValueError) as e:
            raise PlatformAPIError(
                resp.status_code,
                "Unexpected response from server. Please try again.",
            ) from e

    _T = TypeVar("_T", bound=BaseModel)

    @staticmethod
    def _safe_validate(model_cls: type[_T], data: Any) -> _T:
        """Validate data against a Pydantic model, raising PlatformAPIError on failure."""
        try:
            return model_cls.model_validate(data)
        except ValidationError as e:
            raise PlatformAPIError(
                0,
                "Unexpected response format from server. "
                "Try updating: pip install -U superserve",
            ) from e

    def validate_token(self) -> bool:
        """Validate current credentials.

        Returns:
            True if token is valid, False otherwise.
        """
        try:
            resp = self._request("GET", "/auth/validate")
            return bool(resp.json().get("valid", False))
        except PlatformAPIError:
            return False

    def get_device_code(self) -> DeviceCodeResponse:
        """Request OAuth device code for authentication.

        Returns:
            Device code response with verification URI and codes.
        """
        resp = self._request("POST", "/auth/device-code", authenticated=False)
        return self._safe_validate(DeviceCodeResponse, self._safe_json(resp))

    def poll_device_token(self, device_code: str) -> Credentials:
        """Poll for OAuth token after user authorization.

        Args:
            device_code: Device code from get_device_code().

        Returns:
            Credentials if authorized.

        Raises:
            PlatformAPIError: If authorization pending (428) or failed.
        """
        resp = self._request(
            "POST",
            "/auth/device-token",
            json_data={"device_code": device_code},
            authenticated=False,
        )
        data = resp.json()

        # Handle OAuth error responses per RFC 8628
        if "error" in data:
            error = data["error"]
            if error == "authorization_pending":
                raise PlatformAPIError(
                    428,
                    "Authorization pending",
                    {"oauth_error": "authorization_pending"},
                )
            elif error == "slow_down":
                raise PlatformAPIError(400, "Slow down", {"oauth_error": "slow_down"})
            elif error == "expired_token":
                raise PlatformAPIError(
                    410, "Device code expired", {"oauth_error": "expired_token"}
                )
            elif error == "access_denied":
                raise PlatformAPIError(
                    403, "Access denied by user", {"oauth_error": "access_denied"}
                )
            else:
                raise PlatformAPIError(400, data.get("error_description", error))

        # Handle different token key names from various OAuth implementations
        token = data.get("access_token") or data.get("token")
        if not token:
            raise PlatformAPIError(
                500,
                f"Invalid response from auth server: missing token. Response keys: {list(data.keys())}",
            )

        return Credentials(
            token=token,
            expires_at=data.get("expires_at"),
            refresh_token=data.get("refresh_token"),
        )

    # ==================== AGENTS ====================

    def deploy_agent(
        self,
        name: str,
        command: str,
        config: dict,
        tarball_path: str,
    ) -> AgentResponse:
        """Deploy an agent (create or update).

        Sends the project tarball as a multipart form upload to POST /agents.

        Args:
            name: Agent name.
            command: Command to run the agent.
            config: Full superserve.yaml as a dict.
            tarball_path: Path to the .tar.gz package.

        Returns:
            Created or updated agent.
        """
        with open(tarball_path, "rb") as f:
            resp = self._request(
                "POST",
                "/agents",
                files={"file": ("agent.tar.gz", f, "application/gzip")},
                data={
                    "name": name,
                    "command": command,
                    "config": json.dumps(config),
                },
            )
        return self._safe_validate(AgentResponse, self._safe_json(resp))

    def list_agents(self) -> list[AgentResponse]:
        """List all hosted agents.

        Returns:
            List of agents.
        """
        resp = self._request("GET", "/agents")
        data = self._safe_json(resp)
        return [self._safe_validate(AgentResponse, a) for a in data.get("agents", [])]

    def _resolve_agent_id(self, name_or_id: str) -> str:
        """Resolve an agent name to its ID, using cache when possible.

        Args:
            name_or_id: Agent name or ID.

        Returns:
            Agent ID (with agt_ prefix).

        Raises:
            PlatformAPIError: If agent not found.
        """
        # Already an ID
        if name_or_id.startswith("agt_"):
            return name_or_id

        # Check cache first
        if name_or_id in self._agent_name_cache:
            return self._agent_name_cache[name_or_id]

        # Fetch agents and populate cache
        agents = self.list_agents()
        for agent in agents:
            self._agent_name_cache[agent.name] = agent.id

        # Return from cache or raise error
        if name_or_id in self._agent_name_cache:
            return self._agent_name_cache[name_or_id]

        raise PlatformAPIError(404, f"Agent '{name_or_id}' not found")

    def get_agent(self, name_or_id: str) -> AgentResponse:
        """Get a hosted agent by name or ID.

        Args:
            name_or_id: Agent name or ID (with or without agt_ prefix).

        Returns:
            Agent details.
        """
        agent_id = self._resolve_agent_id(name_or_id)
        resp = self._request("GET", f"/agents/{agent_id}")
        return self._safe_validate(AgentResponse, self._safe_json(resp))

    def delete_agent(self, name_or_id: str) -> None:
        """Delete a hosted agent.

        Args:
            name_or_id: Agent name or ID.
        """
        agent_id = self._resolve_agent_id(name_or_id)
        self._request("DELETE", f"/agents/{agent_id}")

        # Invalidate cache entry for the deleted agent
        for name, cached_id in list(self._agent_name_cache.items()):
            if cached_id == agent_id:
                del self._agent_name_cache[name]
                break

    def _resolve_id(
        self, entity_id: str, prefix: str, endpoint: str, entity_name: str
    ) -> str:
        """Resolve an entity ID or short prefix to a full prefixed ID.

        Args:
            entity_id: Full ID, UUID, or short prefix.
            prefix: ID prefix (e.g. "run", "ses").
            endpoint: API resolve endpoint (e.g. "/runs/resolve").
            entity_name: Human-readable name for error messages.

        Returns:
            Full ID with prefix.
        """
        clean = entity_id.replace(f"{prefix}_", "").replace("-", "")
        # Full UUID (32 hex chars) — no need to resolve
        if len(clean) >= 32:
            if not entity_id.startswith(f"{prefix}_"):
                entity_id = f"{prefix}_{entity_id}"
            return entity_id

        # Short prefix — resolve via API
        resp = self._request("GET", endpoint, params={"id_prefix": clean})
        ids: list[str] = resp.json().get("ids", [])
        if len(ids) == 0:
            raise PlatformAPIError(
                404, f"No {entity_name} found matching '{entity_id}'"
            )
        if len(ids) > 1:
            short_ids = [i.replace(f"{prefix}_", "").replace("-", "")[:12] for i in ids]
            raise PlatformAPIError(
                409, f"Ambiguous ID '{entity_id}' — matches: {', '.join(short_ids)}"
            )
        return ids[0]

    def _resolve_session_id(self, session_id: str) -> str:
        """Resolve a session ID or short prefix to a full session ID."""
        return self._resolve_id(session_id, "ses", "/sessions/resolve", "session")

    def _parse_sse_stream(self, resp: requests.Response) -> Iterator[RunEvent]:
        """Parse SSE events from a streaming response using chunk-based reading.

        Uses iter_content(chunk_size=None) for real-time streaming instead of
        iter_lines() which buffers in 512-byte chunks.
        """
        buffer = ""
        current_event_type: str | None = None
        data_lines: list[str] = []

        for chunk in resp.iter_content(chunk_size=None, decode_unicode=True):
            buffer += chunk
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.rstrip("\r")

                if not line:
                    # Empty line = end of SSE event
                    if current_event_type and data_lines:
                        full_data = "\n".join(data_lines)
                        try:
                            parsed = json.loads(full_data)
                        except json.JSONDecodeError:
                            parsed = {"raw": full_data}
                        yield RunEvent(type=current_event_type, data=parsed)
                    current_event_type = None
                    data_lines = []
                    continue

                if line.startswith("event: "):
                    current_event_type = line[7:]
                elif line.startswith("data: "):
                    data_lines.append(line[6:])

    # ==================== AGENT SECRETS ====================

    def get_agent_secrets(self, name_or_id: str) -> list[str]:
        """Get secret keys for an agent (values never returned).

        Args:
            name_or_id: Agent name or ID.

        Returns:
            List of secret key names.
        """
        agent_id = self._resolve_agent_id(name_or_id)
        resp = self._request("GET", f"/agents/{agent_id}/secrets")
        return cast(list[str], resp.json().get("keys", []))

    def set_agent_secrets(self, name_or_id: str, secrets: dict[str, str]) -> list[str]:
        """Set secrets for an agent (merges with existing).

        Args:
            name_or_id: Agent name or ID.
            secrets: Dictionary of secret key-value pairs.

        Returns:
            Updated list of secret key names.
        """
        agent_id = self._resolve_agent_id(name_or_id)
        resp = self._request(
            "PATCH",
            f"/agents/{agent_id}/secrets",
            json_data={"secrets": secrets},
        )
        return cast(list[str], resp.json().get("keys", []))

    def delete_agent_secret(self, name_or_id: str, key: str) -> list[str]:
        """Delete a secret from an agent.

        Args:
            name_or_id: Agent name or ID.
            key: Secret key to delete.

        Returns:
            Updated list of secret key names.
        """
        agent_id = self._resolve_agent_id(name_or_id)
        resp = self._request("DELETE", f"/agents/{agent_id}/secrets/{key}")
        return cast(list[str], resp.json().get("keys", []))

    # ==================== SESSIONS ====================

    def create_session(
        self,
        agent_name_or_id: str,
        title: str | None = None,
        idle_timeout_seconds: int = 30 * 24 * 60 * 60,  # 30 days
    ) -> dict[str, Any]:
        """Create a new session.

        Args:
            agent_name_or_id: Agent name or ID.
            title: Optional session title.
            idle_timeout_seconds: Idle timeout in seconds.

        Returns:
            Session data dictionary.
        """
        agent_id = self._resolve_agent_id(agent_name_or_id)
        resp = self._request(
            "POST",
            "/sessions",
            json_data={
                "agent_id": agent_id,
                "title": title,
                "idle_timeout_seconds": idle_timeout_seconds,
            },
        )
        return cast(dict[str, Any], resp.json())

    def list_sessions(
        self, agent_id: str | None = None, status: str | None = None, limit: int = 20
    ) -> list[dict[str, Any]]:
        """List sessions.

        Args:
            agent_id: Filter by agent name or ID.
            status: Filter by status.
            limit: Maximum number of sessions to return.

        Returns:
            List of session dictionaries.
        """
        params: dict[str, str] = {"limit": str(limit)}
        if agent_id:
            params["agent_id"] = self._resolve_agent_id(agent_id)
        if status:
            params["status"] = status
        resp = self._request("GET", "/sessions", params=params)
        return cast(list[dict[str, Any]], resp.json().get("sessions", []))

    def get_session(self, session_id: str) -> dict[str, Any]:
        """Get session details.

        Args:
            session_id: Session ID or short prefix.

        Returns:
            Session data dictionary.
        """
        session_id = self._resolve_session_id(session_id)
        resp = self._request("GET", f"/sessions/{session_id}")
        return cast(dict[str, Any], resp.json())

    def end_session(self, session_id: str) -> dict[str, Any]:
        """End a session.

        Args:
            session_id: Session ID or short prefix.

        Returns:
            Updated session data dictionary.
        """
        session_id = self._resolve_session_id(session_id)
        resp = self._request("POST", f"/sessions/{session_id}/end")
        return cast(dict[str, Any], resp.json())

    def resume_session(self, session_id: str) -> dict[str, Any]:
        """Resume an idle, completed, or failed session.

        Args:
            session_id: Session ID or short prefix.

        Returns:
            Updated session data dictionary.
        """
        session_id = self._resolve_session_id(session_id)
        resp = self._request("POST", f"/sessions/{session_id}/resume")
        return cast(dict[str, Any], resp.json())

    def stream_session_message(
        self, session_id: str, prompt: str
    ) -> Iterator[RunEvent]:
        """Send a message to a session and stream the response.

        Args:
            session_id: Session ID.
            prompt: User prompt.

        Yields:
            Run events as they arrive.
        """
        resp = self._request(
            "POST",
            f"/sessions/{session_id}/messages",
            json_data={"prompt": prompt},
            stream=True,
        )
        yield from self._parse_sse_stream(resp)
