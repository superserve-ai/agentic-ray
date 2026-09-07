"""Tests for HTTP layer: api_request, retries, User-Agent, etc."""

from __future__ import annotations

import httpx
import pytest
import respx
from superserve._http import (
    SDK_VERSION,
    USER_AGENT,
    api_request,
    async_api_request,
    download_bytes,
    stream_sse,
    upload_bytes,
)
from superserve.errors import (
    AuthenticationError,
    NotFoundError,
    SandboxError,
    SandboxTimeoutError,
    ServerError,
    ValidationError,
)


@pytest.fixture
def zero_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make retry sleeps instant for fast tests."""
    import asyncio as _asyncio
    import time as _time

    monkeypatch.setattr(_time, "sleep", lambda _s: None)

    async def _noop_sleep(_s: float) -> None:
        return None

    monkeypatch.setattr(_asyncio, "sleep", _noop_sleep)


class TestApiRequest:
    def test_get_returns_parsed_json(self) -> None:
        with respx.mock(assert_all_called=True) as router:
            router.get("https://api.example.com/foo").mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            result = api_request(
                "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            assert result == {"ok": True}

    def test_204_returns_none(self) -> None:
        with respx.mock() as router:
            router.delete("https://api.example.com/foo").mock(
                return_value=httpx.Response(204)
            )
            result = api_request(
                "DELETE", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            assert result is None

    def test_400_raises_validation_error(self) -> None:
        with respx.mock() as router:
            router.post("https://api.example.com/foo").mock(
                return_value=httpx.Response(400, json={"error": {"message": "bad"}})
            )
            with pytest.raises(ValidationError):
                api_request(
                    "POST",
                    "https://api.example.com/foo",
                    headers={"X-API-Key": "k"},
                    json_body={},
                )

    def test_401_raises_authentication_error(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/foo").mock(
                return_value=httpx.Response(401, json={"error": {"message": "nope"}})
            )
            with pytest.raises(AuthenticationError):
                api_request(
                    "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
                )

    def test_404_raises_not_found_error(self) -> None:
        with respx.mock() as router:
            router.delete("https://api.example.com/foo").mock(
                return_value=httpx.Response(404, json={"error": {"message": "gone"}})
            )
            with pytest.raises(NotFoundError):
                api_request(
                    "DELETE", "https://api.example.com/foo", headers={"X-API-Key": "k"}
                )

    def test_user_agent_header_present(self) -> None:
        with respx.mock() as router:
            route = router.get("https://api.example.com/foo").mock(
                return_value=httpx.Response(200, json={})
            )
            api_request(
                "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            request = route.calls.last.request
            assert request.headers.get("User-Agent") == USER_AGENT
            assert SDK_VERSION in request.headers.get("User-Agent", "")
            assert "python/" in request.headers.get("User-Agent", "")

    def test_user_supplied_header_overrides_default(self) -> None:
        with respx.mock() as router:
            route = router.get("https://api.example.com/foo").mock(
                return_value=httpx.Response(200, json={})
            )
            api_request(
                "GET",
                "https://api.example.com/foo",
                headers={"X-API-Key": "k", "User-Agent": "custom-agent/1.0"},
            )
            assert route.calls.last.request.headers["User-Agent"] == "custom-agent/1.0"


class TestTimeouts:
    def test_timeout_raises_sandbox_timeout(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/foo").mock(
                side_effect=httpx.TimeoutException("slow")
            )
            with pytest.raises(SandboxTimeoutError):
                api_request(
                    "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
                )


class TestRetriesSync:
    def test_get_503_retries_then_succeeds(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.get("https://api.example.com/foo").mock(
                side_effect=[
                    httpx.Response(503, json={"error": {"message": "nope"}}),
                    httpx.Response(503, json={"error": {"message": "nope"}}),
                    httpx.Response(200, json={"ok": True}),
                ]
            )
            result = api_request(
                "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            assert result == {"ok": True}
            assert route.call_count == 3

    def test_get_503_exhausts_retries_then_raises(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.get("https://api.example.com/foo").mock(
                return_value=httpx.Response(503, json={"error": {"message": "no"}})
            )
            with pytest.raises(ServerError):
                api_request(
                    "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
                )
            assert route.call_count == 3

    def test_429_with_retry_after_zero_retries(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.get("https://api.example.com/foo").mock(
                side_effect=[
                    httpx.Response(
                        429,
                        headers={"Retry-After": "0"},
                        json={"error": {"message": "slow down"}},
                    ),
                    httpx.Response(200, json={"ok": True}),
                ]
            )
            result = api_request(
                "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            assert result == {"ok": True}
            assert route.call_count == 2

    def test_post_on_503_does_not_retry(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.post("https://api.example.com/foo").mock(
                return_value=httpx.Response(503, json={"error": {"message": "no"}})
            )
            with pytest.raises(ServerError):
                api_request(
                    "POST",
                    "https://api.example.com/foo",
                    headers={"X-API-Key": "k"},
                    json_body={},
                )
            assert route.call_count == 1

    def test_post_on_400_does_not_retry(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.post("https://api.example.com/foo").mock(
                return_value=httpx.Response(400, json={"error": {"message": "bad"}})
            )
            with pytest.raises(ValidationError):
                api_request(
                    "POST",
                    "https://api.example.com/foo",
                    headers={"X-API-Key": "k"},
                    json_body={},
                )
            assert route.call_count == 1

    def test_delete_retries_on_502(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.delete("https://api.example.com/foo").mock(
                side_effect=[
                    httpx.Response(502, json={"error": {"message": "gateway"}}),
                    httpx.Response(204),
                ]
            )
            result = api_request(
                "DELETE", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            assert result is None
            assert route.call_count == 2

    def test_delete_retries_on_409_with_retry_conflict(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.delete("https://api.example.com/foo").mock(
                side_effect=[
                    httpx.Response(409, json={"error": {"code": "conflict"}}),
                    httpx.Response(409, json={"error": {"code": "conflict"}}),
                    httpx.Response(204),
                ]
            )
            result = api_request(
                "DELETE",
                "https://api.example.com/foo",
                headers={"X-API-Key": "k"},
                retry_conflict=True,
            )
            assert result is None
            assert route.call_count == 3

    def test_delete_409_without_retry_conflict_fails_fast(self, zero_sleep: None) -> None:
        from superserve.errors import ConflictError

        with respx.mock() as router:
            route = router.delete("https://api.example.com/foo").mock(
                return_value=httpx.Response(409, json={"error": {"code": "conflict"}})
            )
            with pytest.raises(ConflictError):
                api_request(
                    "DELETE",
                    "https://api.example.com/foo",
                    headers={"X-API-Key": "k"},
                    retry_conflict=False,
                )
            assert route.call_count == 1

    def test_connect_error_retries_on_get(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.get("https://api.example.com/foo").mock(
                side_effect=[
                    httpx.ConnectError("down"),
                    httpx.Response(200, json={"ok": True}),
                ]
            )
            result = api_request(
                "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            assert result == {"ok": True}
            assert route.call_count == 2

    def test_connect_error_does_not_retry_on_post(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.post("https://api.example.com/foo").mock(
                side_effect=httpx.ConnectError("down")
            )
            with pytest.raises(SandboxError):
                api_request(
                    "POST",
                    "https://api.example.com/foo",
                    headers={"X-API-Key": "k"},
                    json_body={},
                )
            assert route.call_count == 1


class TestDownloadBytes:
    def test_returns_bytes_on_success(self) -> None:
        with respx.mock() as router:
            router.get("https://data.example.com/files").mock(
                return_value=httpx.Response(200, content=b"hello world")
            )
            result = download_bytes(
                "https://data.example.com/files",
                headers={"X-Access-Token": "t"},
            )
            assert result == b"hello world"

    def test_retries_on_503(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.get("https://data.example.com/files").mock(
                side_effect=[
                    httpx.Response(503, json={"error": {"message": "no"}}),
                    httpx.Response(200, content=b"ok"),
                ]
            )
            result = download_bytes(
                "https://data.example.com/files",
                headers={"X-Access-Token": "t"},
            )
            assert result == b"ok"
            assert route.call_count == 2


class TestUploadBytes:
    def test_success(self) -> None:
        with respx.mock() as router:
            route = router.post("https://data.example.com/files").mock(
                return_value=httpx.Response(200)
            )
            upload_bytes(
                "https://data.example.com/files",
                headers={"X-Access-Token": "t"},
                content=b"payload",
            )
            assert route.call_count == 1

    def test_503_does_not_retry(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.post("https://data.example.com/files").mock(
                return_value=httpx.Response(503, json={"error": {"message": "no"}})
            )
            with pytest.raises(ServerError):
                upload_bytes(
                    "https://data.example.com/files",
                    headers={"X-Access-Token": "t"},
                    content=b"payload",
                )
            assert route.call_count == 1


class TestPooledClient:
    def test_shared_client_reused(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/foo").mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            with httpx.Client() as client:
                r1 = api_request(
                    "GET",
                    "https://api.example.com/foo",
                    headers={"X-API-Key": "k"},
                    client=client,
                )
                r2 = api_request(
                    "GET",
                    "https://api.example.com/foo",
                    headers={"X-API-Key": "k"},
                    client=client,
                )
                assert r1 == {"ok": True}
                assert r2 == {"ok": True}
                # client not closed since we own it outside


class TestAsyncApiRequest:
    async def test_get_returns_parsed_json(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/foo").mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            result = await async_api_request(
                "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            assert result == {"ok": True}

    async def test_user_agent_header_present(self) -> None:
        with respx.mock() as router:
            route = router.get("https://api.example.com/foo").mock(
                return_value=httpx.Response(200, json={})
            )
            await async_api_request(
                "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            assert route.calls.last.request.headers["User-Agent"] == USER_AGENT

    async def test_retries_on_503(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.get("https://api.example.com/foo").mock(
                side_effect=[
                    httpx.Response(503, json={"error": {"message": "no"}}),
                    httpx.Response(200, json={"ok": True}),
                ]
            )
            result = await async_api_request(
                "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
            )
            assert result == {"ok": True}
            assert route.call_count == 2

    async def test_delete_retries_on_409_with_retry_conflict(self, zero_sleep: None) -> None:
        with respx.mock() as router:
            route = router.delete("https://api.example.com/foo").mock(
                side_effect=[
                    httpx.Response(409, json={"error": {"code": "conflict"}}),
                    httpx.Response(204),
                ]
            )
            result = await async_api_request(
                "DELETE",
                "https://api.example.com/foo",
                headers={"X-API-Key": "k"},
                retry_conflict=True,
            )
            assert result is None
            assert route.call_count == 2

    async def test_timeout_raises_sandbox_timeout(self) -> None:
        with respx.mock() as router:
            router.get("https://api.example.com/foo").mock(
                side_effect=httpx.TimeoutException("slow")
            )
            with pytest.raises(SandboxTimeoutError):
                await async_api_request(
                    "GET", "https://api.example.com/foo", headers={"X-API-Key": "k"}
                )


class TestStreamSSEGet:
    def test_uses_get_without_body(self) -> None:
        with respx.mock() as router:
            route = router.get(
                "https://api.example.com/templates/t/builds/b/logs"
            ).mock(
                return_value=httpx.Response(
                    200,
                    text=(
                        'data: {"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"hi"}\n\n'
                        'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}\n\n'
                    ),
                )
            )
            events: list = []
            stream_sse(
                "https://api.example.com/templates/t/builds/b/logs",
                headers={"X-API-Key": "k"},
                json_body=None,
                method="GET",
                on_event=lambda ev: events.append(ev),
            )
            assert len(events) == 2
            assert route.call_count == 1
            assert route.calls.last.request.content == b""
