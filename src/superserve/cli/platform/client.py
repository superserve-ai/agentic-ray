"""HTTP client for Superserve Platform API."""

from __future__ import annotations

import json
from collections.abc import Iterator

import requests

from .auth import get_credentials
from .config import DEFAULT_TIMEOUT, PLATFORM_API_URL, USER_AGENT
from .types import (
    AgentConfig,
    AgentResponse,
    Credentials,
    DeviceCodeResponse,
    LogEntry,
    ProjectManifest,
    ProjectResponse,
    RunEvent,
    RunResponse,
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
                raise PlatformAPIError(
                    response.status_code,
                    error_data.get("detail")
                    or error_data.get("message")
                    or response.reason,
                    error_data.get("details"),
                )
            return response

        except requests.exceptions.ConnectionError as e:
            raise PlatformAPIError(0, f"Cannot connect to Platform API: {e}") from e
        except requests.exceptions.Timeout as e:
            raise PlatformAPIError(0, "Request timeout") from e

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
        return DeviceCodeResponse.model_validate(resp.json())

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

    def create_project(
        self,
        name: str,
        package_path: str,
        manifest: ProjectManifest,
        env_vars: dict[str, str] | None = None,
    ) -> ProjectResponse:
        """Create a new project.

        Args:
            name: Project name.
            package_path: Path to project package (.zip).
            manifest: Project manifest with agent configurations.
            env_vars: Environment variables for the project.

        Returns:
            Project response with status and URL.
        """
        with open(package_path, "rb") as f:
            files = {"package": (f"{name}.zip", f, "application/zip")}
            form_data: dict[str, str] = {"manifest": manifest.model_dump_json()}
            if env_vars:
                form_data["env_vars"] = json.dumps(env_vars)

            resp = self._request("POST", "/projects", files=files, data=form_data)

        return self._parse_project_response(resp.json())

    def get_project(self, name: str) -> ProjectResponse:
        """Get project by name.

        Args:
            name: Project name.

        Returns:
            Project response.
        """
        resp = self._request("GET", f"/projects/{name}")
        return self._parse_project_response(resp.json())

    def list_projects(self) -> list[ProjectResponse]:
        """List all projects.

        Returns:
            List of project responses.
        """
        resp = self._request("GET", "/projects")
        projects = resp.json().get("projects", [])
        return [self._parse_project_response(d) for d in projects]

    def delete_project(self, name: str) -> None:
        """Delete a project.

        Args:
            name: Project name.
        """
        self._request("DELETE", f"/projects/{name}")

    def _parse_project_response(self, data: dict) -> ProjectResponse:
        """Parse project response from API.

        Args:
            data: Raw response data.

        Returns:
            Parsed ProjectResponse.
        """
        return ProjectResponse.model_validate(data)

    def get_logs(
        self, name: str, tail: int = 100, agent: str | None = None
    ) -> list[LogEntry]:
        """Get project logs.

        Args:
            name: Project name.
            tail: Number of lines to retrieve.
            agent: Filter by agent name.

        Returns:
            List of log entries.
        """
        query_params: dict[str, int | str] = {"tail": tail}
        if agent:
            query_params["agent"] = agent

        resp = self._request("GET", f"/projects/{name}/logs", params=query_params)
        logs = resp.json().get("logs", [])
        return [LogEntry.model_validate(log) for log in logs]

    def stream_logs(self, name: str, agent: str | None = None) -> Iterator[LogEntry]:
        """Stream project logs via Server-Sent Events.

        Args:
            name: Project name.
            agent: Filter by agent name.

        Yields:
            Log entries as they arrive.
        """
        query_params: dict[str, str] | None = {"agent": agent} if agent else None
        resp = self._request(
            "GET", f"/projects/{name}/logs/stream", params=query_params, stream=True
        )

        for line in resp.iter_lines():
            if line and line.startswith(b"data: "):
                try:
                    data = json.loads(line[6:])
                    yield LogEntry.model_validate(data)
                except (json.JSONDecodeError, ValueError):
                    continue

    # ==================== AGENTS ====================

    def create_agent(self, config: AgentConfig) -> AgentResponse:
        """Create a new hosted agent.

        Args:
            config: Agent configuration.

        Returns:
            Created agent.
        """
        resp = self._request(
            "POST",
            "/agents",
            json_data={
                "name": config.name,
                "model": config.model,
                "system_prompt": config.system_prompt,
                "tools": config.tools,
                "max_turns": config.max_turns,
                "timeout_seconds": config.timeout_seconds,
            },
        )
        return AgentResponse.model_validate(resp.json())

    def list_agents(self) -> list[AgentResponse]:
        """List all hosted agents.

        Returns:
            List of agents.
        """
        resp = self._request("GET", "/agents")
        data = resp.json()
        return [AgentResponse.model_validate(a) for a in data.get("agents", [])]

    def get_agent(self, name_or_id: str) -> AgentResponse:
        """Get a hosted agent by name or ID.

        Args:
            name_or_id: Agent name or ID (with or without agt_ prefix).

        Returns:
            Agent details.
        """
        # If it looks like a name (no prefix), try to find by name
        if not name_or_id.startswith("agt_"):
            agents = self.list_agents()
            for agent in agents:
                if agent.name == name_or_id:
                    return agent
            raise PlatformAPIError(404, f"Agent '{name_or_id}' not found")

        resp = self._request("GET", f"/agents/{name_or_id}")
        return AgentResponse.model_validate(resp.json())

    def delete_agent(self, name_or_id: str) -> None:
        """Delete a hosted agent.

        Args:
            name_or_id: Agent name or ID.
        """
        # Resolve name to ID if needed
        if not name_or_id.startswith("agt_"):
            agent = self.get_agent(name_or_id)
            name_or_id = agent.id

        self._request("DELETE", f"/agents/{name_or_id}")

    # ==================== RUNS ====================

    def create_run(
        self,
        agent_id: str,
        prompt: str,
        session_id: str | None = None,
    ) -> RunResponse:
        """Create a new run for an agent.

        Args:
            agent_id: Agent ID or name.
            prompt: User prompt.
            session_id: Optional session ID for multi-turn.

        Returns:
            Created run.
        """
        # Resolve name to ID if needed
        if not agent_id.startswith("agt_"):
            agent = self.get_agent(agent_id)
            agent_id = agent.id

        data: dict[str, str] = {
            "agent_id": agent_id,
            "prompt": prompt,
        }
        if session_id:
            data["session_id"] = session_id

        resp = self._request("POST", "/runs", json_data=data)
        return RunResponse.model_validate(resp.json())

    def list_runs(
        self,
        agent_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
    ) -> list[RunResponse]:
        """List runs.

        Args:
            agent_id: Filter by agent ID or name.
            status: Filter by status.
            limit: Maximum number of runs to return.

        Returns:
            List of runs.
        """
        params: dict[str, int | str] = {"limit": limit}

        if agent_id:
            if not agent_id.startswith("agt_"):
                agent = self.get_agent(agent_id)
                agent_id = agent.id
            params["agent_id"] = agent_id

        if status:
            params["status"] = status

        resp = self._request("GET", "/runs", params=params)
        data = resp.json()
        return [RunResponse.model_validate(r) for r in data.get("runs", [])]

    def get_run(self, run_id: str) -> RunResponse:
        """Get a run by ID.

        Args:
            run_id: Run ID (with or without run_ prefix).

        Returns:
            Run details.
        """
        if not run_id.startswith("run_"):
            run_id = f"run_{run_id}"

        resp = self._request("GET", f"/runs/{run_id}")
        return RunResponse.model_validate(resp.json())

    def cancel_run(self, run_id: str) -> RunResponse:
        """Cancel a running run.

        Args:
            run_id: Run ID.

        Returns:
            Updated run.
        """
        if not run_id.startswith("run_"):
            run_id = f"run_{run_id}"

        resp = self._request("POST", f"/runs/{run_id}/cancel")
        return RunResponse.model_validate(resp.json())

    def stream_run(self, run_id: str) -> Iterator[RunEvent]:
        """Stream run events via SSE.

        Args:
            run_id: Run ID.

        Yields:
            Run events as they arrive.
        """
        if not run_id.startswith("run_"):
            run_id = f"run_{run_id}"

        resp = self._request("GET", f"/runs/{run_id}/events", stream=True)

        current_event_type = None
        for line in resp.iter_lines():
            if not line:
                continue

            line_str = line.decode("utf-8") if isinstance(line, bytes) else line

            if line_str.startswith("event: "):
                current_event_type = line_str[7:]
            elif line_str.startswith("data: ") and current_event_type:
                try:
                    data = json.loads(line_str[6:])
                    yield RunEvent(type=current_event_type, data=data)
                except json.JSONDecodeError:
                    continue
                current_event_type = None
