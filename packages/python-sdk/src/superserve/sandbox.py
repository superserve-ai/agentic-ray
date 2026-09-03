"""Sync Sandbox class — primary entry point for the Superserve Python SDK."""

from __future__ import annotations

import builtins
import threading
from typing import TYPE_CHECKING, Any
from urllib.parse import quote, urlencode

import httpx

from ._config import ResolvedConfig, preview_url, resolve_config
from ._http import api_request
from .commands import Commands, CommandsDeps
from .desktop import DESKTOP_STREAM_PORT, Desktop, DesktopDeps
from .errors import NotFoundError, SandboxError
from .files import Files, FilesDeps
from .types import (
    UNSET,
    build_update_body,
    list_query,
    NetworkConfig,
    NetworkLogPage,
    NetworkVerdict,
    PreviewAccess,
    PreviewAccessPolicy,
    PreviewPortList,
    PreviewToken,
    PublishedPreviewPort,
    SandboxInfo,
    SandboxSecretBinding,
    SandboxStatus,
    to_network_log_page,
    to_sandbox_info,
)

if TYPE_CHECKING:
    from .async_template import AsyncTemplate
    from .template import Template


class Sandbox:
    """A sandbox handle - call methods directly (`sandbox.commands.run(...)`, etc.)."""

    def __init__(
        self,
        info: SandboxInfo,
        access_token: str,
        config: ResolvedConfig,
    ) -> None:
        self.id: str = info.id
        self.name: str = info.name
        self.status: SandboxStatus = info.status
        self.metadata: dict[str, str] = info.metadata
        self.preview_access: PreviewAccess = info.preview_access
        # Secrets bound at construction time; call get_info() to refresh.
        self.secrets: list[SandboxSecretBinding] | None = info.secrets
        self._access_token: str = access_token
        self._config = config
        self._http_client: httpx.Client = httpx.Client(timeout=30.0)
        self._closed = False
        self._refresh_lock = threading.Lock()

        self.commands = Commands(
            CommandsDeps(
                sandbox_id=self.id,
                sandbox_host=config.sandbox_host,
                get_access_token=lambda: self._access_token,
                refresh_activate=self._refresh_activate,
            ),
            client=self._http_client,
        )
        self.files = Files(
            FilesDeps(
                sandbox_id=self.id,
                sandbox_host=config.sandbox_host,
                get_access_token=lambda: self._access_token,
                refresh_activate=self._refresh_activate,
            ),
            client=self._http_client,
        )

        def _publish_stream_port() -> None:
            self.publish_preview_port(DESKTOP_STREAM_PORT)

        self.desktop = Desktop(
            DesktopDeps(
                sandbox_id=self.id,
                sandbox_host=config.sandbox_host,
                get_access_token=lambda: self._access_token,
                refresh_activate=self._refresh_activate,
                publish_stream_port=_publish_stream_port,
                stream_base_url=lambda: self.get_preview_url(DESKTOP_STREAM_PORT),
            ),
            client=self._http_client,
        )

    def _post_and_rotate_token(self, endpoint: str) -> str:
        """POST a token-rotating endpoint (``resume`` or ``activate``) and
        update the cached token. ``commands`` and ``files`` read the token
        live, so they pick up the rotation. Returns the new token.
        """
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/{endpoint}",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        token = raw.get("access_token") if raw else None
        if not isinstance(token, str) or not token:
            raise SandboxError(
                f"Invalid API response from POST /sandboxes/{self.id}/{endpoint}: "
                "missing access_token"
            )
        self._access_token = token
        return token

    def _refresh_activate(self) -> str:
        """Slow-path fallback for data-plane AuthenticationError. Lock
        serializes refreshes so concurrent callers don't race the
        server-side BeginResume claim (the loser gets 409).
        """
        with self._refresh_lock:
            return self._post_and_rotate_token("activate")

    @classmethod
    def create(
        cls,
        *,
        name: str,
        from_template: "str | Template | AsyncTemplate | None" = None,
        from_snapshot: str | None = None,
        timeout_seconds: int | None = None,
        auto_delete_seconds: int | None = None,
        metadata: dict[str, str] | None = None,
        env_vars: dict[str, str] | None = None,
        secrets: dict[str, str] | None = None,
        network: NetworkConfig | None = None,
        preview_access: PreviewAccessPolicy | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> Sandbox:
        """Create a new sandbox. Returns once the sandbox is ready.

        ``secrets`` binds team-stored secrets to environment variables as
        ``{ENV_VAR: secret_name}``: the agent sees a proxy token under each env
        var; the in-host daemon swaps it for the real credential at egress.
        """
        config = resolve_config(api_key=api_key, base_url=base_url)

        body: dict[str, Any] = {"name": name}
        if from_template is not None:
            if isinstance(from_template, str):
                body["from_template"] = from_template
            else:
                # Template / AsyncTemplate instance — extract name (fallback to id)
                body["from_template"] = (
                    getattr(from_template, "name", None) or from_template.id
                )
        if from_snapshot is not None:
            body["from_snapshot"] = from_snapshot
        if timeout_seconds is not None:
            body["timeout_seconds"] = timeout_seconds
        if auto_delete_seconds is not None:
            body["auto_delete_seconds"] = auto_delete_seconds
        if metadata is not None:
            body["metadata"] = metadata
        if env_vars is not None:
            body["env_vars"] = env_vars
        if secrets is not None:
            body["secrets"] = secrets
        if network:
            body["network"] = {
                "allow_out": network.allow_out,
                "deny_out": network.deny_out,
            }
        if preview_access is not None:
            body["preview_access"] = preview_access

        raw = api_request(
            "POST",
            f"{config.base_url}/sandboxes",
            headers={"X-API-Key": config.api_key},
            json_body=body,
        )
        token = raw.get("access_token") if raw else None
        if not token:
            raise SandboxError(
                "Invalid API response from POST /sandboxes: missing access_token"
            )
        return cls(to_sandbox_info(raw), token, config)

    @classmethod
    def connect(
        cls,
        sandbox_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> Sandbox:
        """Connect to an existing sandbox by ID.

        Calls ``POST /activate`` so the returned instance is guaranteed to
        be active (paused sandboxes are auto-resumed) with a fresh access
        token.
        """
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "POST",
            f"{config.base_url}/sandboxes/{sandbox_id}/activate",
            headers={"X-API-Key": config.api_key},
        )
        token = raw.get("access_token") if raw else None
        if not token:
            raise SandboxError(
                f"Invalid API response from POST /sandboxes/{sandbox_id}/activate: "
                "missing access_token"
            )
        return cls(to_sandbox_info(raw), token, config)

    @classmethod
    def list(
        cls,
        *,
        metadata: dict[str, str] | None = None,
        status: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> builtins.list[SandboxInfo]:
        """List sandboxes belonging to the authenticated team.

        Optional filters: ``metadata`` (AND semantics), ``status``, and
        ``limit``/``offset`` paging. Without ``limit`` the full list is
        returned.
        """
        config = resolve_config(api_key=api_key, base_url=base_url)
        url = f"{config.base_url}/sandboxes"
        query = list_query(metadata, status, limit, offset)
        if query:
            url += f"?{query}"

        raw = api_request("GET", url, headers={"X-API-Key": config.api_key})
        return [to_sandbox_info(item) for item in raw]

    @classmethod
    def kill_by_id(
        cls,
        sandbox_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        """Delete a sandbox by ID. Idempotent."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            api_request(
                "DELETE",
                f"{config.base_url}/sandboxes/{sandbox_id}",
                headers={"X-API-Key": config.api_key},
            )
        except NotFoundError:
            pass  # Already deleted

    @classmethod
    def update_by_id(
        cls,
        sandbox_id: str,
        *,
        metadata: dict[str, str] | None = None,
        network: NetworkConfig | None = None,
        auto_delete_seconds: int | None = UNSET,
        timeout_seconds: int | None = UNSET,
        preview_access: PreviewAccessPolicy | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        """Update a sandbox by ID without holding a live instance.

        Unlike ``connect(id).update(...)`` this does not activate the sandbox —
        a paused sandbox stays paused. Pass ``None`` for ``auto_delete_seconds``
        / ``timeout_seconds`` to clear them; omit to leave unchanged.
        """
        config = resolve_config(api_key=api_key, base_url=base_url)
        api_request(
            "PATCH",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
            json_body=build_update_body(
                metadata=metadata,
                network=network,
                auto_delete_seconds=auto_delete_seconds,
                timeout_seconds=timeout_seconds,
                preview_access=preview_access,
            ),
        )

    # Methods on sandbox

    def _close_http_client(self) -> None:
        if not self._closed:
            self._closed = True
            try:
                self._http_client.close()
            except Exception:
                pass

    def _require_not_deleted(self) -> None:
        """Reject calls on a deleted handle without requiring an active VM."""
        if self._closed:
            raise SandboxError(
                f"Sandbox {self.id!r} has been deleted; create or connect to a new one."
            )

    def get_info(self) -> SandboxInfo:
        """Refresh this sandbox's info from the API."""
        self._require_not_deleted()
        raw = api_request(
            "GET",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        return to_sandbox_info(raw)

    def get_preview_url(self, port: int) -> str:
        """Build the preview URL for a port running inside this sandbox.

        This is pure string construction. Under strict public/private policies,
        publish the port first; private URLs also need a header token or a
        signed URL from :meth:`get_signed_preview_url`.

        Raises:
            ValidationError: if ``port`` is not an integer in [1024, 65535].
        """
        return preview_url(self.id, self._config.sandbox_host, port)

    def list_preview_ports(self) -> PreviewPortList:
        """Return the sandbox default and each published port's access mode."""
        self._require_not_deleted()
        raw = api_request(
            "GET",
            f"{self._config.base_url}/sandboxes/{self.id}/preview-ports",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        return PreviewPortList(
            preview_access=PreviewAccess(raw.get("preview_access", "legacy_public")),
            ports=[PublishedPreviewPort(**p) for p in raw.get("ports", [])],
        )

    def publish_preview_port(
        self, port: int, *, access: PreviewAccessPolicy | None = None
    ) -> PublishedPreviewPort:
        """Publish a port, optionally overriding its public/private access mode.

        Omitting ``access`` uses the sandbox default for a new port and preserves
        the current mode when the port is already published.
        """
        self._require_not_deleted()
        self.get_preview_url(port)
        body: dict[str, object] = {"port": port}
        if access is not None:
            body["access"] = access
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/preview-ports",
            headers={"X-API-Key": self._config.api_key},
            json_body=body,
            client=self._http_client,
        )
        return PublishedPreviewPort(**raw)

    def unpublish_preview_port(self, port: int) -> None:
        """Unpublish a port and revoke its outstanding tokens."""
        self._require_not_deleted()
        self.get_preview_url(port)
        api_request(
            "DELETE",
            f"{self._config.base_url}/sandboxes/{self.id}/preview-ports/{port}",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )

    def get_preview_token(
        self, port: int, *, expires_in_seconds: int | None = None
    ) -> PreviewToken:
        """Mint a header/query credential for an already-published port."""
        self._require_not_deleted()
        self.get_preview_url(port)
        body = (
            {}
            if expires_in_seconds is None
            else {"expires_in_seconds": expires_in_seconds}
        )
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/preview-ports/{port}/token",
            headers={"X-API-Key": self._config.api_key},
            json_body=body,
            client=self._http_client,
        )
        return PreviewToken(**raw)

    def get_signed_preview_url(self, port: int, *, expires_in_seconds: int = 60) -> str:
        """Return a browser URL that bootstraps a secure preview cookie."""
        credential = self.get_preview_token(port, expires_in_seconds=expires_in_seconds)
        return f"{self.get_preview_url(port)}?{urlencode({credential.query_param: credential.token})}"

    def rotate_preview_token(self, port: int) -> PreviewToken:
        """Rotate this port's token generation and return a fresh token."""
        self._require_not_deleted()
        self.get_preview_url(port)
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/preview-ports/{port}/token/rotate",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        return PreviewToken(**raw)

    def pause(self) -> None:
        """Pause this sandbox. The sandbox transitions to ``paused``."""
        self._require_not_deleted()
        api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/pause",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )

    def resume(self) -> None:
        """Resume a paused sandbox.

        The access token is rotated; ``sandbox.commands`` and ``sandbox.files``
        pick up the fresh token transparently.
        """
        self._require_not_deleted()
        self._post_and_rotate_token("resume")

    def kill(self) -> None:
        """Delete this sandbox and all its resources. Idempotent."""
        if self._closed:
            return
        try:
            api_request(
                "DELETE",
                f"{self._config.base_url}/sandboxes/{self.id}",
                headers={"X-API-Key": self._config.api_key},
                client=self._http_client,
            )
        except NotFoundError:
            pass  # Already deleted
        finally:
            self._close_http_client()

    def update(
        self,
        *,
        metadata: dict[str, str] | None = None,
        network: NetworkConfig | None = None,
        auto_delete_seconds: int | None = UNSET,
        timeout_seconds: int | None = UNSET,
        preview_access: PreviewAccessPolicy | None = None,
    ) -> None:
        """Partially update this sandbox.

        ``auto_delete_seconds`` sets the auto-delete window (counting from now
        when the sandbox is already paused); pass ``None`` to disable
        auto-delete. ``timeout_seconds`` sets the auto-pause timeout; pass
        ``None`` to disable auto-pause. Omit either to leave it unchanged.
        """
        self._require_not_deleted()
        body = build_update_body(
            metadata=metadata,
            network=network,
            auto_delete_seconds=auto_delete_seconds,
            timeout_seconds=timeout_seconds,
            preview_access=preview_access,
        )

        api_request(
            "PATCH",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            json_body=body,
            client=self._http_client,
        )

    def get_network_log(
        self,
        *,
        limit: int | None = None,
        before: str | None = None,
        since: str | None = None,
        verdict: "NetworkVerdict | str | None" = None,
    ) -> NetworkLogPage:
        """The sandbox's network log: every outbound connection it made, newest
        first. ``connection`` rows are raw egress (host, bytes, allow/deny
        verdict); ``request`` rows are credential-injected requests (method,
        path, status, secret used).

        Filter by time window (``since``/``before``) and ``verdict``. Paginate
        by passing the returned ``next_cursor`` as ``before`` while ``has_more``.
        """
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if before is not None:
            params["before"] = before
        if since is not None:
            params["since"] = since
        if verdict is not None:
            params["verdict"] = (
                verdict.value if isinstance(verdict, NetworkVerdict) else verdict
            )
        url = f"{self._config.base_url}/sandboxes/{self.id}/network"
        if params:
            url += "?" + urlencode(params)
        raw = api_request(
            "GET",
            url,
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )
        return to_network_log_page(raw)

    def attach_secret(self, env_key: str, secret_name: str) -> None:
        """Bind a team secret to this sandbox under an environment variable.

        The sandbox sees a stand-in token; the real credential is swapped in for
        outbound requests to the secret's allowed hosts. Takes effect for
        processes started after this call; a paused sandbox applies it on resume.
        """
        self._require_not_deleted()
        api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/secrets",
            headers={"X-API-Key": self._config.api_key},
            json_body={"env_key": env_key, "secret_name": secret_name},
            client=self._http_client,
        )

    def detach_secret(self, env_key: str) -> None:
        """Remove a secret binding from this sandbox by its env-var key.

        The stand-in token is revoked, so requests using it are refused — within
        about a minute for a process already running. A paused sandbox applies
        the change on resume.
        """
        self._require_not_deleted()
        api_request(
            "DELETE",
            f"{self._config.base_url}/sandboxes/{self.id}/secrets/{quote(env_key, safe='')}",
            headers={"X-API-Key": self._config.api_key},
            client=self._http_client,
        )

    def __repr__(self) -> str:
        return (
            f"Sandbox(id={self.id!r}, name={self.name!r}, status={self.status.value!r})"
        )
