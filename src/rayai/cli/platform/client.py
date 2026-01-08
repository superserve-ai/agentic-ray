"""HTTP client for RayAI Platform API."""

from __future__ import annotations

import json
from collections.abc import Iterator

import requests

from .auth import get_credentials
from .config import DEFAULT_TIMEOUT, PLATFORM_API_URL, USER_AGENT
from .types import (
    Credentials,
    DeploymentManifest,
    DeploymentResponse,
    DeviceCodeResponse,
    LogEntry,
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
    """HTTP client for RayAI Platform API."""

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
                    401, "Not authenticated. Run 'rayai login' first."
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
                    error_data.get("message", response.reason),
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

        # Handle OAuth 2.0 device flow error responses (RFC 8628)
        if "error" in data:
            raise PlatformAPIError(
                400,
                data.get("error_description", data["error"]),
                {"oauth_error": data["error"]},
            )

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

    def create_deployment(
        self,
        name: str,
        package_path: str,
        manifest: DeploymentManifest,
        env_vars: dict[str, str] | None = None,
    ) -> DeploymentResponse:
        """Create a new deployment.

        Args:
            name: Deployment name.
            package_path: Path to deployment package (.tar.gz).
            manifest: Deployment manifest with agent configurations.
            env_vars: Environment variables for the deployment.

        Returns:
            Deployment response with status and URL.
        """
        with open(package_path, "rb") as f:
            files = {"package": (f"{name}.zip", f, "application/zip")}
            form_data: dict[str, str] = {"manifest": manifest.model_dump_json()}
            if env_vars:
                form_data["env_vars"] = json.dumps(env_vars)

            resp = self._request("POST", "/deployments", files=files, data=form_data)

        return self._parse_deployment_response(resp.json())

    def get_deployment(self, name: str) -> DeploymentResponse:
        """Get deployment by name.

        Args:
            name: Deployment name.

        Returns:
            Deployment response.
        """
        resp = self._request("GET", f"/deployments/{name}")
        return self._parse_deployment_response(resp.json())

    def list_deployments(self) -> list[DeploymentResponse]:
        """List all deployments.

        Returns:
            List of deployment responses.
        """
        resp = self._request("GET", "/deployments")
        deployments = resp.json().get("deployments", [])
        return [self._parse_deployment_response(d) for d in deployments]

    def delete_deployment(self, name: str) -> None:
        """Delete a deployment.

        Args:
            name: Deployment name.
        """
        self._request("DELETE", f"/deployments/{name}")

    def _parse_deployment_response(self, data: dict) -> DeploymentResponse:
        """Parse deployment response from API.

        Args:
            data: Raw response data.

        Returns:
            Parsed DeploymentResponse.
        """
        return DeploymentResponse.model_validate(data)

    def get_logs(
        self, name: str, tail: int = 100, agent: str | None = None
    ) -> list[LogEntry]:
        """Get deployment logs.

        Args:
            name: Deployment name.
            tail: Number of lines to retrieve.
            agent: Filter by agent name.

        Returns:
            List of log entries.
        """
        query_params: dict[str, int | str] = {"tail": tail}
        if agent:
            query_params["agent"] = agent

        resp = self._request("GET", f"/deployments/{name}/logs", params=query_params)
        logs = resp.json().get("logs", [])
        return [LogEntry.model_validate(log) for log in logs]

    def stream_logs(self, name: str, agent: str | None = None) -> Iterator[LogEntry]:
        """Stream deployment logs via Server-Sent Events.

        Args:
            name: Deployment name.
            agent: Filter by agent name.

        Yields:
            Log entries as they arrive.
        """
        query_params: dict[str, str] | None = {"agent": agent} if agent else None
        resp = self._request(
            "GET", f"/deployments/{name}/logs/stream", params=query_params, stream=True
        )

        for line in resp.iter_lines():
            if line and line.startswith(b"data: "):
                try:
                    data = json.loads(line[6:])
                    yield LogEntry.model_validate(data)
                except (json.JSONDecodeError, ValueError):
                    continue
