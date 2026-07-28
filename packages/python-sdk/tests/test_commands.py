"""Tests for Commands.run — sync & streaming."""

from __future__ import annotations

import httpx
import pytest
import respx
from superserve.commands import Commands, CommandsDeps
from superserve.errors import AuthenticationError, SandboxError

SANDBOX_HOST = "sandbox.example.com"
SBX = "sbx-1"
DATA_PLANE = f"https://boxd-{SBX}.{SANDBOX_HOST}"


def _make_deps(
    *,
    initial_token: str = "tok-initial",
    refreshed_token: str = "tok-refreshed",
) -> tuple[CommandsDeps, dict]:
    """Returns deps + a state dict so tests can inspect refresh count."""
    state: dict = {"token": initial_token, "refreshes": 0}

    def refresh() -> str:
        state["refreshes"] += 1
        state["token"] = refreshed_token
        return refreshed_token

    deps = CommandsDeps(
        sandbox_id=SBX,
        sandbox_host=SANDBOX_HOST,
        get_access_token=lambda: state["token"],
        refresh_activate=refresh,
    )
    return deps, state


def _make_commands() -> Commands:
    deps, _ = _make_deps()
    return Commands(deps)


class TestCommandsRun:
    def test_hits_data_plane_with_access_token(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{DATA_PLANE}/exec").mock(
                return_value=httpx.Response(
                    200,
                    json={"stdout": "hi\n", "stderr": "", "exit_code": 0},
                )
            )
            result = _make_commands().run("echo hi")
            assert result.stdout == "hi\n"

            req = route.calls.last.request
            assert req.headers.get("x-access-token") == "tok-initial"
            assert "x-api-key" not in {k.lower() for k in req.headers}

    def test_sync_with_env_and_cwd(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{DATA_PLANE}/exec").mock(
                return_value=httpx.Response(
                    200, json={"stdout": "ok", "stderr": "", "exit_code": 0}
                )
            )
            _make_commands().run(
                "ls", cwd="/tmp", env={"FOO": "bar"}, timeout_seconds=10
            )
            request_body = route.calls.last.request.content
            assert b"/tmp" in request_body
            assert b"FOO" in request_body

    def test_surfaces_truncated_flag(self) -> None:
        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "stdout": "partial",
                        "stderr": "",
                        "exit_code": 0,
                        "truncated": True,
                    },
                )
            )
            result = _make_commands().run("yes")
            assert result.truncated is True
            assert result.exit_code == 0

    def test_truncated_defaults_false(self) -> None:
        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec").mock(
                return_value=httpx.Response(
                    200, json={"stdout": "hi", "stderr": "", "exit_code": 0}
                )
            )
            assert _make_commands().run("echo hi").truncated is False

    def test_nonzero_exit_code(self) -> None:
        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec").mock(
                return_value=httpx.Response(
                    200, json={"stdout": "", "stderr": "boom", "exit_code": 1}
                )
            )
            result = _make_commands().run("false")
            assert result.exit_code == 1
            assert result.stderr == "boom"

    def test_refreshes_token_and_retries_on_401(self) -> None:
        deps, state = _make_deps()
        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec").mock(
                side_effect=[
                    httpx.Response(401, json={"error": {"code": "auth_failed"}}),
                    httpx.Response(
                        200,
                        json={"stdout": "ok\n", "stderr": "", "exit_code": 0},
                    ),
                ]
            )
            result = Commands(deps).run("echo")
            assert result.stdout == "ok\n"
            assert state["refreshes"] == 1

    def test_does_not_retry_on_non_auth_errors(self) -> None:
        deps, state = _make_deps()
        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec").mock(
                return_value=httpx.Response(
                    500, json={"error": {"code": "server_error"}}
                )
            )
            with pytest.raises(SandboxError):
                Commands(deps).run("echo")
        assert state["refreshes"] == 0

    def test_resumes_and_retries_on_503(self) -> None:
        deps, state = _make_deps()
        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec").mock(
                side_effect=[
                    httpx.Response(
                        503,
                        json={
                            "error": {
                                "code": "sandbox_paused",
                                "message": "sandbox is paused",
                            }
                        },
                    ),
                    httpx.Response(
                        200,
                        json={"stdout": "ok\n", "stderr": "", "exit_code": 0},
                    ),
                ]
            )
            result = Commands(deps).run("echo")
            assert result.stdout == "ok\n"
            assert state["refreshes"] == 1

    def test_propagates_auth_error_when_refresh_also_fails(self) -> None:
        deps, _ = _make_deps()
        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec").mock(
                return_value=httpx.Response(
                    401, json={"error": {"code": "auth_failed"}}
                )
            )
            with pytest.raises(AuthenticationError):
                Commands(deps).run("echo")


class TestCommandsStreaming:
    def test_streaming_calls_callbacks(self) -> None:
        sse_body = (
            'data: {"stdout": "hello "}\n\n'
            'data: {"stdout": "world\\n"}\n\n'
            'data: {"stderr": "warn\\n"}\n\n'
            'data: {"finished": true, "exit_code": 0}\n\n'
        )
        stdout_chunks: list[str] = []
        stderr_chunks: list[str] = []

        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec/stream").mock(
                return_value=httpx.Response(
                    200,
                    content=sse_body.encode(),
                    headers={"Content-Type": "text/event-stream"},
                )
            )
            result = _make_commands().run(
                "echo hello world",
                on_stdout=stdout_chunks.append,
                on_stderr=stderr_chunks.append,
            )

        assert stdout_chunks == ["hello ", "world\n"]
        assert stderr_chunks == ["warn\n"]
        assert result.stdout == "hello world\n"
        assert result.stderr == "warn\n"
        assert result.exit_code == 0

    def test_streaming_raises_if_no_finished_event(self) -> None:
        sse_body = 'data: {"stdout": "partial"}\n\n'

        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec/stream").mock(
                return_value=httpx.Response(
                    200,
                    content=sse_body.encode(),
                    headers={"Content-Type": "text/event-stream"},
                )
            )
            with pytest.raises(SandboxError, match="finished"):
                _make_commands().run("echo partial", on_stdout=lambda _c: None)

    def test_streaming_with_nonzero_exit_code(self) -> None:
        sse_body = (
            'data: {"stderr": "err\\n"}\n\n'
            'data: {"finished": true, "exit_code": 42}\n\n'
        )

        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec/stream").mock(
                return_value=httpx.Response(
                    200,
                    content=sse_body.encode(),
                    headers={"Content-Type": "text/event-stream"},
                )
            )
            result = _make_commands().run("fail", on_stderr=lambda _c: None)

        assert result.exit_code == 42
        assert result.stderr == "err\n"

    def test_streaming_retry_on_401_does_not_double_emit_callbacks(
        self,
    ) -> None:
        deps, state = _make_deps()
        sse_body = (
            'data: {"stdout": "one"}\n\ndata: {"finished": true, "exit_code": 0}\n\n'
        )
        with respx.mock() as router:
            router.post(f"{DATA_PLANE}/exec/stream").mock(
                side_effect=[
                    httpx.Response(401, json={"error": {"code": "auth_failed"}}),
                    httpx.Response(
                        200,
                        content=sse_body.encode(),
                        headers={"Content-Type": "text/event-stream"},
                    ),
                ]
            )

            received: list[str] = []
            result = Commands(deps).run("echo", on_stdout=received.append)

        # Callbacks fire exactly once — the 401 attempt never invoked on_stdout
        assert received == ["one"]
        assert result.stdout == "one"
        assert result.exit_code == 0
        assert state["refreshes"] == 1


class TestCommandsSharedHostRouting:
    def test_uses_shared_host_when_supported(self) -> None:
        deps = CommandsDeps(
            sandbox_id=SBX,
            sandbox_host="sandbox.superserve.ai",
            get_access_token=lambda: "tok",
            refresh_activate=lambda: "tok",
        )
        with respx.mock() as router:
            route = router.post("https://sandbox.superserve.ai/exec").mock(
                return_value=httpx.Response(
                    200, json={"stdout": "ok", "stderr": "", "exit_code": 0}
                )
            )
            Commands(deps).run("echo")
            req = route.calls.last.request
            assert req.headers.get("x-superserve-sandbox-id") == SBX
            assert req.headers.get("x-access-token") == "tok"

    def test_falls_back_to_subdomain_on_unsupported_host(self) -> None:
        deps = CommandsDeps(
            sandbox_id=SBX,
            sandbox_host="self-hosted.example.org",
            get_access_token=lambda: "tok",
            refresh_activate=lambda: "tok",
        )
        with respx.mock() as router:
            route = router.post(
                f"https://boxd-{SBX}.self-hosted.example.org/exec"
            ).mock(
                return_value=httpx.Response(
                    200, json={"stdout": "ok", "stderr": "", "exit_code": 0}
                )
            )
            Commands(deps).run("echo")
            req = route.calls.last.request
            assert "x-superserve-sandbox-id" not in {k.lower() for k in req.headers}

    def test_streaming_carries_sandbox_id_header_on_shared_host(self) -> None:
        deps = CommandsDeps(
            sandbox_id=SBX,
            sandbox_host="sandbox.superserve.ai",
            get_access_token=lambda: "tok",
            refresh_activate=lambda: "tok",
        )
        sse_body = (
            'data: {"stdout": "x"}\n\ndata: {"finished": true, "exit_code": 0}\n\n'
        )
        with respx.mock() as router:
            route = router.post("https://sandbox.superserve.ai/exec/stream").mock(
                return_value=httpx.Response(
                    200,
                    content=sse_body.encode(),
                    headers={"Content-Type": "text/event-stream"},
                )
            )
            Commands(deps).run("echo", on_stdout=lambda _c: None)
            req = route.calls.last.request
            assert req.headers.get("x-superserve-sandbox-id") == SBX

    def test_preserves_sandbox_id_header_after_401_retry_on_shared_host(self) -> None:
        deps = CommandsDeps(
            sandbox_id=SBX,
            sandbox_host="sandbox.superserve.ai",
            get_access_token=lambda: "tok",
            refresh_activate=lambda: "tok-refreshed",
        )
        with respx.mock() as router:
            route = router.post("https://sandbox.superserve.ai/exec").mock(
                side_effect=[
                    httpx.Response(401, json={"error": {"code": "auth_failed"}}),
                    httpx.Response(
                        200,
                        json={"stdout": "ok\n", "stderr": "", "exit_code": 0},
                    ),
                ]
            )
            Commands(deps).run("echo")
            second = route.calls[1].request
            assert second.headers.get("x-superserve-sandbox-id") == SBX
            assert second.headers.get("x-access-token") == "tok-refreshed"
