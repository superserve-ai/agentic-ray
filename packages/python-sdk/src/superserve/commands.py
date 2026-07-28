"""``sandbox.commands`` - run shell commands inside a sandbox.

Hits the per-sandbox data plane with the access token. A paused sandbox (401
stale token, or 503 because the VM isn't running) is transparently resumed via
``POST /activate`` and the call is retried once — see ``_token_retry``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, NoReturn

import httpx

from ._config import data_plane_target
from ._http import api_request, async_api_request, async_stream_sse, stream_sse
from ._token_retry import async_with_token_retry, with_token_retry
from .command_session import AsyncCommandSession, AsyncSpawnDeps, spawn_command
from .errors import SandboxError
from .types import CommandResult


@dataclass(frozen=True)
class CommandsDeps:
    """Internal deps from Sandbox. ``refresh_activate`` is invoked on 401."""

    sandbox_id: str
    sandbox_host: str
    get_access_token: Callable[[], str]
    refresh_activate: Callable[[], str]


@dataclass(frozen=True)
class AsyncCommandsDeps:
    """Async variant of CommandsDeps."""

    sandbox_id: str
    sandbox_host: str
    get_access_token: Callable[[], str]
    refresh_activate: Callable[[], Awaitable[str]]


class Commands:
    """Sync command execution. Access as ``sandbox.commands``."""

    def __init__(
        self,
        deps: CommandsDeps,
        client: httpx.Client | None = None,
    ) -> None:
        self._deps = deps
        self._client = client
        target = data_plane_target(deps.sandbox_id, deps.sandbox_host)
        self._data_plane_base_url = target.url
        self._routing_headers = target.headers

    def run(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout_seconds: int | None = None,
        on_stdout: Callable[[str], None] | None = None,
        on_stderr: Callable[[str], None] | None = None,
    ) -> CommandResult:
        """Execute a command inside the sandbox.

        Paused sandboxes are transparently resumed before execution.
        """
        body: dict[str, Any] = {"command": command}
        if cwd is not None:
            body["working_dir"] = cwd
        if env is not None:
            body["env"] = env
        if timeout_seconds is not None:
            body["timeout_s"] = timeout_seconds

        is_streaming = on_stdout is not None or on_stderr is not None

        if is_streaming:
            return self._run_streaming(body, on_stdout, on_stderr, timeout_seconds)
        return self._run_sync(body, timeout_seconds)

    def spawn(self, command: str, **kwargs: Any) -> NoReturn:
        """Spawn a full-duplex command session — async only.

        Full-duplex stdin/output over a WebSocket doesn't fit a blocking call.
        Use ``AsyncSandbox`` and ``await sandbox.commands.spawn(...)``.
        """
        raise NotImplementedError(
            "commands.spawn (full-duplex exec) is async-only. Use AsyncSandbox: "
            "`await sandbox.commands.spawn(...)`."
        )

    def _run_sync(
        self,
        body: dict[str, Any],
        timeout_seconds: int | None,
    ) -> CommandResult:
        def send(token: str) -> Any:
            return api_request(
                "POST",
                f"{self._data_plane_base_url}/exec",
                headers={**self._routing_headers, "X-Access-Token": token},
                json_body=body,
                timeout=float(timeout_seconds) + 5.0
                if timeout_seconds is not None
                else 30.0,
                client=self._client,
            )

        raw: dict[str, Any] = with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )
        return CommandResult(
            stdout=raw.get("stdout", ""),
            stderr=raw.get("stderr", ""),
            exit_code=raw.get("exit_code", 0),
            truncated=raw.get("truncated", False),
        )

    def _run_streaming(
        self,
        body: dict[str, Any],
        on_stdout: Callable[[str], None] | None,
        on_stderr: Callable[[str], None] | None,
        timeout_seconds: int | None,
    ) -> CommandResult:
        def send(token: str) -> CommandResult:
            return self._consume_stream(
                f"{self._data_plane_base_url}/exec/stream",
                {**self._routing_headers, "X-Access-Token": token},
                body,
                on_stdout,
                on_stderr,
                timeout_seconds,
            )

        # Safe for streaming: the resumable status (401/503) arrives before any
        # SSE data is written, so a retry can't double-emit callbacks.
        return with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )

    def _consume_stream(
        self,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        on_stdout: Callable[[str], None] | None,
        on_stderr: Callable[[str], None] | None,
        timeout_seconds: int | None,
    ) -> CommandResult:
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        exit_code = 0
        saw_finished = False

        def handle_event(event: dict[str, Any]) -> None:
            nonlocal exit_code, saw_finished
            if event.get("stdout"):
                stdout_parts.append(event["stdout"])
                if on_stdout:
                    on_stdout(event["stdout"])
            if event.get("stderr"):
                stderr_parts.append(event["stderr"])
                if on_stderr:
                    on_stderr(event["stderr"])
            if event.get("finished"):
                saw_finished = True
                exit_code = event.get("exit_code", 0)
                if event.get("error"):
                    stderr_parts.append(event["error"])

        stream_sse(
            url,
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) + 5.0
            if timeout_seconds is not None
            else 300.0,
            on_event=handle_event,
            client=self._client,
        )

        if not saw_finished:
            raise SandboxError(
                "Command stream ended without a finished event "
                "(possible network disconnect)"
            )

        return CommandResult(
            stdout="".join(stdout_parts),
            stderr="".join(stderr_parts),
            exit_code=exit_code,
        )


class AsyncCommands:
    """Async command execution. Access as ``sandbox.commands``."""

    def __init__(
        self,
        deps: AsyncCommandsDeps,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._deps = deps
        self._client = client
        target = data_plane_target(deps.sandbox_id, deps.sandbox_host)
        self._data_plane_base_url = target.url
        self._routing_headers = target.headers

    async def run(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout_seconds: int | None = None,
        on_stdout: Callable[[str], None] | None = None,
        on_stderr: Callable[[str], None] | None = None,
    ) -> CommandResult:
        """Async variant of Commands.run()."""
        body: dict[str, Any] = {"command": command}
        if cwd is not None:
            body["working_dir"] = cwd
        if env is not None:
            body["env"] = env
        if timeout_seconds is not None:
            body["timeout_s"] = timeout_seconds

        is_streaming = on_stdout is not None or on_stderr is not None

        if is_streaming:
            return await self._run_streaming(
                body, on_stdout, on_stderr, timeout_seconds
            )
        return await self._run_sync(body, timeout_seconds)

    async def spawn(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout_seconds: int | None = None,
        on_stdout: Callable[[str], None] | None = None,
        on_stderr: Callable[[str], None] | None = None,
    ) -> AsyncCommandSession:
        """Spawn a command and return a live, full-duplex session.

        Unlike ``run`` (one-shot), ``spawn`` hands back a handle while the
        process is still running: stream output via ``on_stdout`` /
        ``on_stderr``, write to its ``stdin``, ``kill`` it, and
        ``await session.wait()`` for the exit result. Omit ``timeout_seconds``
        for a long-lived process; a paused sandbox is resumed before the
        session opens.

        Use ``async with`` (or call ``wait()`` / ``close()``) so the socket and
        its reader are cleaned up when you're done.

        Example::

            async with await sandbox.commands.spawn("python -i") as session:
                await session.stdin.write("print(2 + 2)\\n")
                await session.stdin.close()
                result = await session.wait()
        """
        return await spawn_command(
            AsyncSpawnDeps(
                sandbox_id=self._deps.sandbox_id,
                sandbox_host=self._deps.sandbox_host,
                get_access_token=self._deps.get_access_token,
                refresh_activate=self._deps.refresh_activate,
            ),
            command,
            cwd=cwd,
            env=env,
            timeout_seconds=timeout_seconds,
            on_stdout=on_stdout,
            on_stderr=on_stderr,
        )

    async def _run_sync(
        self,
        body: dict[str, Any],
        timeout_seconds: int | None,
    ) -> CommandResult:
        async def send(token: str) -> Any:
            return await async_api_request(
                "POST",
                f"{self._data_plane_base_url}/exec",
                headers={**self._routing_headers, "X-Access-Token": token},
                json_body=body,
                timeout=float(timeout_seconds) + 5.0
                if timeout_seconds is not None
                else 30.0,
                client=self._client,
            )

        raw: dict[str, Any] = await async_with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )
        return CommandResult(
            stdout=raw.get("stdout", ""),
            stderr=raw.get("stderr", ""),
            exit_code=raw.get("exit_code", 0),
            truncated=raw.get("truncated", False),
        )

    async def _run_streaming(
        self,
        body: dict[str, Any],
        on_stdout: Callable[[str], None] | None,
        on_stderr: Callable[[str], None] | None,
        timeout_seconds: int | None,
    ) -> CommandResult:
        async def send(token: str) -> CommandResult:
            return await self._consume_stream(
                f"{self._data_plane_base_url}/exec/stream",
                {**self._routing_headers, "X-Access-Token": token},
                body,
                on_stdout,
                on_stderr,
                timeout_seconds,
            )

        return await async_with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )

    async def _consume_stream(
        self,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        on_stdout: Callable[[str], None] | None,
        on_stderr: Callable[[str], None] | None,
        timeout_seconds: int | None,
    ) -> CommandResult:
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        exit_code = 0
        saw_finished = False

        def handle_event(event: dict[str, Any]) -> None:
            nonlocal exit_code, saw_finished
            if event.get("stdout"):
                stdout_parts.append(event["stdout"])
                if on_stdout:
                    on_stdout(event["stdout"])
            if event.get("stderr"):
                stderr_parts.append(event["stderr"])
                if on_stderr:
                    on_stderr(event["stderr"])
            if event.get("finished"):
                saw_finished = True
                exit_code = event.get("exit_code", 0)
                if event.get("error"):
                    stderr_parts.append(event["error"])

        await async_stream_sse(
            url,
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) + 5.0
            if timeout_seconds is not None
            else 300.0,
            on_event=handle_event,
            client=self._client,
        )

        if not saw_finished:
            raise SandboxError(
                "Command stream ended without a finished event "
                "(possible network disconnect)"
            )

        return CommandResult(
            stdout="".join(stdout_parts),
            stderr="".join(stderr_parts),
            exit_code=exit_code,
        )
