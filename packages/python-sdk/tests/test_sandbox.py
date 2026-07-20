"""Tests for the Sandbox class — sync."""

from __future__ import annotations

import json

import httpx
import pytest
import respx
from superserve import Sandbox, SandboxError, SandboxStatus, ValidationError

API = "https://api.example.com"


def _raw(
    status: str = "active",
    sbx_id: str = "sbx-1",
    access_token: str | None = "tok",
) -> dict:
    data: dict = {
        "id": sbx_id,
        "name": "test",
        "status": status,
        "created_at": "2026-01-01T00:00:00Z",
    }
    if access_token is not None:
        data["access_token"] = access_token
    return data


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


class TestGetPreviewUrl:
    def _make(self, router: respx.MockRouter) -> Sandbox:
        router.post(f"{API}/sandboxes").mock(
            return_value=httpx.Response(200, json=_raw())
        )
        return Sandbox.create(name="my-box")

    def test_builds_preview_url(self) -> None:
        with respx.mock() as router:
            sandbox = self._make(router)
            try:
                assert (
                    sandbox.get_preview_url(3000)
                    == "https://3000-sbx-1.sandbox.superserve.ai"
                )
            finally:
                sandbox._close_http_client()

    def test_distinct_urls_per_port(self) -> None:
        with respx.mock() as router:
            sandbox = self._make(router)
            try:
                assert (
                    sandbox.get_preview_url(3000)
                    == "https://3000-sbx-1.sandbox.superserve.ai"
                )
                assert (
                    sandbox.get_preview_url(8080)
                    == "https://8080-sbx-1.sandbox.superserve.ai"
                )
            finally:
                sandbox._close_http_client()

    def test_invalid_port_raises(self) -> None:
        with respx.mock() as router:
            sandbox = self._make(router)
            try:
                with pytest.raises(ValidationError):
                    sandbox.get_preview_url(80)
            finally:
                sandbox._close_http_client()


class TestPreviewAuthentication:
    def _make(self, router: respx.MockRouter) -> Sandbox:
        router.post(f"{API}/sandboxes").mock(
            return_value=httpx.Response(
                200, json={**_raw(), "preview_access": "private"}
            )
        )
        return Sandbox.create(name="private", preview_access="private")

    def test_publish_list_mint_signed_rotate_and_unpublish(self) -> None:
        with respx.mock() as router:
            sandbox = self._make(router)
            publish = router.post(f"{API}/sandboxes/sbx-1/preview-ports").mock(
                return_value=httpx.Response(
                    200,
                    json={"port": 3000, "token_version": 1, "access": "private"},
                )
            )
            router.get(f"{API}/sandboxes/sbx-1/preview-ports").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "preview_access": "private",
                        "ports": [
                            {"port": 3000, "token_version": 1, "access": "private"}
                        ],
                    },
                )
            )
            token_payload = {
                "token": "spv1.secret",
                "port": 3000,
                "header": "X-Superserve-Preview-Token",
                "query_param": "superserve_preview_token",
                "token_version": 1,
                "access": "private",
                "preview_access": "private",
            }
            mint = router.post(f"{API}/sandboxes/sbx-1/preview-ports/3000/token").mock(
                return_value=httpx.Response(200, json=token_payload)
            )
            rotate = router.post(
                f"{API}/sandboxes/sbx-1/preview-ports/3000/token/rotate"
            ).mock(
                return_value=httpx.Response(
                    200, json={**token_payload, "token_version": 2}
                )
            )
            unpublish = router.delete(f"{API}/sandboxes/sbx-1/preview-ports/3000").mock(
                return_value=httpx.Response(204)
            )

            try:
                assert sandbox.preview_access.value == "private"
                published = sandbox.publish_preview_port(3000, access="private")
                assert published.token_version == 1
                assert published.access == "private"
                assert json.loads(publish.calls.last.request.content) == {
                    "port": 3000,
                    "access": "private",
                }
                assert sandbox.list_preview_ports().ports[0].access == "private"
                credential = sandbox.get_preview_token(3000)
                assert credential.header == "X-Superserve-Preview-Token"
                assert credential.access == "private"
                assert "spv1.secret" not in repr(credential)
                assert "spv1.secret" not in str(credential)
                signed = sandbox.get_signed_preview_url(3000, expires_in_seconds=3600)
                assert signed.endswith("?superserve_preview_token=spv1.secret")
                assert json.loads(mint.calls.last.request.content) == {
                    "expires_in_seconds": 3600
                }
                assert sandbox.rotate_preview_token(3000).token_version == 2
                assert rotate.call_count == 1
                assert sandbox.unpublish_preview_port(3000) is None
                assert unpublish.call_count == 1
            finally:
                sandbox._close_http_client()


class TestCreate:
    def test_posts_and_returns_instance(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sandbox = Sandbox.create(name="my-box")
            try:
                assert sandbox.id == "sbx-1"
                assert sandbox.name == "test"
                assert sandbox.status == SandboxStatus.ACTIVE
                assert route.call_count == 1
                # body has name
                assert b"my-box" in route.calls.last.request.content
                # access_token stored privately
                assert sandbox._access_token == "tok"
            finally:
                sandbox._close_http_client()

    def test_sends_preview_access(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(
                    200, json={**_raw(), "preview_access": "private"}
                )
            )
            sandbox = Sandbox.create(name="my-box", preview_access="private")
            try:
                assert (
                    json.loads(route.calls.last.request.content)["preview_access"]
                    == "private"
                )
                assert sandbox.preview_access.value == "private"
            finally:
                sandbox._close_http_client()

    def test_missing_access_token_raises(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw(access_token=None))
            )
            with pytest.raises(SandboxError, match="access_token"):
                Sandbox.create(name="my-box")


class TestConnect:
    def test_gets_and_returns_instance(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sandbox = Sandbox.connect("sbx-1")
            try:
                assert sandbox.id == "sbx-1"
                assert sandbox._access_token == "tok"
                assert route.call_count == 1
            finally:
                sandbox._close_http_client()

    def test_missing_access_token_raises(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw(access_token=None))
            )
            with pytest.raises(SandboxError, match="access_token"):
                Sandbox.connect("sbx-1")


class TestList:
    def test_returns_list(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/sandboxes").mock(
                return_value=httpx.Response(
                    200,
                    json=[
                        _raw(sbx_id="a", access_token=None),
                        _raw(sbx_id="b", access_token=None),
                    ],
                )
            )
            infos = Sandbox.list()
            assert len(infos) == 2
            assert infos[0].id == "a"
            assert infos[1].id == "b"

    def test_passes_metadata_filter(self) -> None:
        with respx.mock() as router:
            route = router.get(url__regex=rf"{API}/sandboxes.*").mock(
                return_value=httpx.Response(200, json=[])
            )
            Sandbox.list(metadata={"env": "prod"})
            assert "metadata.env=prod" in str(route.calls.last.request.url)


class TestKillById:
    def test_success(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(204)
            )
            Sandbox.kill_by_id("sbx-1")

    def test_swallows_404(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(404, json={"error": {"message": "gone"}})
            )
            # should NOT raise
            Sandbox.kill_by_id("sbx-1")


class TestInstanceMethods:
    def test_kill_swallows_404(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(404, json={"error": {"message": "gone"}})
            )
            sandbox = Sandbox.connect("sbx-1")
            # Should not raise
            sandbox.kill()

    def test_repr_includes_id_and_status(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sandbox = Sandbox.connect("sbx-1")
            try:
                r = repr(sandbox)
                assert "sbx-1" in r
                assert "active" in r
                # access_token must NOT leak into repr
                assert "tok" not in r
            finally:
                sandbox._close_http_client()

    def test_calls_after_kill_raise_sandbox_error(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.delete(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(204)
            )
            sbx = Sandbox.create(name="x")
            sbx.kill()
            with pytest.raises(SandboxError, match="has been deleted"):
                sbx.get_info()
            with pytest.raises(SandboxError, match="has been deleted"):
                sbx.pause()
            # kill() itself stays safe (no-op on already-killed)
            sbx.kill()

    def test_pause_returns_none(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            pause_route = router.post(f"{API}/sandboxes/sbx-1/pause").mock(
                return_value=httpx.Response(204)
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                result = sbx.pause()
                assert result is None
                assert pause_route.call_count == 1
            finally:
                sbx._close_http_client()

    def test_resume_rotates_token_files_reads_it_live(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.post(f"{API}/sandboxes/sbx-1/resume").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "id": "sbx-1",
                        "status": "active",
                        "access_token": "rotated-tok",
                    },
                )
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                old_files = sbx.files
                result = sbx.resume()
                assert result is None
                assert sbx._access_token == "rotated-tok"
                # files reads the token live — same instance, picks up rotation
                assert sbx.files is old_files
            finally:
                sbx._close_http_client()

    def test_resume_missing_access_token_raises(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            router.post(f"{API}/sandboxes/sbx-1/resume").mock(
                return_value=httpx.Response(
                    200, json={"id": "sbx-1", "status": "active"}
                )
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                with pytest.raises(SandboxError, match="access_token"):
                    sbx.resume()
            finally:
                sbx._close_http_client()

    def test_update_metadata(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            route = router.patch(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(204)
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                sbx.update(metadata={"env": "prod"})
                assert route.call_count == 1
                # metadata is a readonly snapshot; callers must use get_info()
                # for fresh data. This matches the TS SDK contract.
                assert sbx.metadata == {}
            finally:
                sbx._close_http_client()

    def test_update_auto_delete_set_clear_omit(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            route = router.patch(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(204)
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                sbx.update(auto_delete_seconds=3600)
                assert json.loads(route.calls[0].request.content) == {
                    "auto_delete_seconds": 3600
                }
                # Explicit None clears the window on the wire.
                sbx.update(auto_delete_seconds=None)
                assert json.loads(route.calls[1].request.content) == {
                    "auto_delete_seconds": None
                }
                # Omitted entirely: the field must not appear in the body.
                sbx.update(metadata={"env": "prod"})
                assert json.loads(route.calls[2].request.content) == {
                    "metadata": {"env": "prod"}
                }
                # timeout_seconds follows the same set/clear contract.
                sbx.update(timeout_seconds=900)
                assert json.loads(route.calls[3].request.content) == {
                    "timeout_seconds": 900
                }
                sbx.update(timeout_seconds=None)
                assert json.loads(route.calls[4].request.content) == {
                    "timeout_seconds": None
                }
            finally:
                sbx._close_http_client()

    def test_update_by_id_patches_without_activating(self) -> None:
        # assert_all_called=False: the activate route is registered only to
        # prove update_by_id never calls it.
        with respx.mock(assert_all_called=False) as router:
            activate = router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            patch = router.patch(f"{API}/sandboxes/sbx-1").mock(
                return_value=httpx.Response(204)
            )
            Sandbox.update_by_id("sbx-1", auto_delete_seconds=3600)
            # The point of update_by_id: never resume the sandbox.
            assert not activate.called
            assert patch.call_count == 1
            assert json.loads(patch.calls[0].request.content) == {
                "auto_delete_seconds": 3600
            }

    def test_attach_secret_posts_binding(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            route = router.post(f"{API}/sandboxes/sbx-1/secrets").mock(
                return_value=httpx.Response(
                    201,
                    json={
                        "env_key": "ANTHROPIC_API_KEY",
                        "secret_name": "anthropic-prod",
                    },
                )
            )
            sbx = Sandbox.connect("sbx-1")
            try:
                sbx.attach_secret("ANTHROPIC_API_KEY", "anthropic-prod")
                assert route.call_count == 1
                body = route.calls.last.request.content
                assert b'"env_key"' in body
                assert b"ANTHROPIC_API_KEY" in body
                assert b"anthropic-prod" in body
            finally:
                sbx._close_http_client()

    def test_detach_secret_deletes_by_env_key(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/sandboxes/sbx-1/activate").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            route = router.delete(
                f"{API}/sandboxes/sbx-1/secrets/ANTHROPIC_API_KEY"
            ).mock(return_value=httpx.Response(204))
            sbx = Sandbox.connect("sbx-1")
            try:
                result = sbx.detach_secret("ANTHROPIC_API_KEY")
                assert result is None
                assert route.call_count == 1
            finally:
                sbx._close_http_client()


class TestCreateFromTemplate:
    def test_maps_string(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sbx = Sandbox.create(name="b", from_template="superserve/python-3.11")
            try:
                body = route.calls.last.request.content
                assert b'"from_template"' in body
                assert b"superserve/python-3.11" in body
            finally:
                sbx._close_http_client()

    def test_maps_instance(self) -> None:
        from superserve import Template

        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(
                    202,
                    json={
                        "id": "t-1",
                        "team_id": "team-1",
                        "name": "my-env",
                        "status": "building",
                        "vcpu": 1,
                        "memory_mib": 1024,
                        "disk_mib": 4096,
                        "created_at": "2026-01-01T00:00:00Z",
                        "build_id": "b-1",
                    },
                )
            )
            tpl = Template.create(name="my-env", from_="python:3.11")
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sbx = Sandbox.create(name="b", from_template=tpl)
            try:
                body = route.calls.last.request.content
                assert (
                    b'"from_template": "my-env"' in body
                    or b'"from_template":"my-env"' in body
                )
            finally:
                sbx._close_http_client()

    def test_maps_from_snapshot(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            sbx = Sandbox.create(name="b", from_snapshot="snap-abc")
            try:
                body = route.calls.last.request.content
                assert b"snap-abc" in body
                assert b"from_snapshot" in body
            finally:
                sbx._close_http_client()


class TestConcurrentRefresh:
    def test_serialized_refresh_under_concurrent_401(self) -> None:
        import threading

        sbx_id = "sbx-conc"
        sandbox_host = "sandbox.example.com"
        data_plane = f"https://boxd-{sbx_id}.{sandbox_host}"

        exec_call_count = 0
        activate_call_count = 0
        activate_lock = threading.Lock()
        exec_lock = threading.Lock()

        def exec_response(_request: httpx.Request) -> httpx.Response:
            nonlocal exec_call_count
            with exec_lock:
                exec_call_count += 1
                this_call = exec_call_count
            # First two calls (one per thread) 401; subsequent succeed
            if this_call <= 2:
                return httpx.Response(401, json={"error": {"code": "auth_failed"}})
            return httpx.Response(
                200, json={"stdout": "ok", "stderr": "", "exit_code": 0}
            )

        def activate_response(_request: httpx.Request) -> httpx.Response:
            nonlocal activate_call_count
            with activate_lock:
                activate_call_count += 1
            # Slow enough to maximize chance of overlap if the lock were missing
            import time as _t

            _t.sleep(0.02)
            return httpx.Response(
                200,
                json={
                    "id": sbx_id,
                    "name": "c",
                    "status": "active",
                    "created_at": "2026-01-01T00:00:00Z",
                    "access_token": "tok-refreshed",
                },
            )

        with respx.mock(base_url=API, assert_all_called=False) as router:
            router.post(f"{API}/sandboxes/{sbx_id}/activate").mock(
                side_effect=activate_response
            )
            router.post(f"{data_plane}/exec").mock(side_effect=exec_response)

            sbx = Sandbox.connect(sbx_id, api_key="ss_live_x", base_url=API)
            try:
                # Override sandbox_host so the data-plane URL matches our mock
                sbx._config = sbx._config.__class__(
                    api_key=sbx._config.api_key,
                    base_url=sbx._config.base_url,
                    sandbox_host=sandbox_host,
                )
                sbx.commands._data_plane_base_url = data_plane

                results: list[Exception | str] = [None, None]  # type: ignore

                def worker(idx: int) -> None:
                    try:
                        r = sbx.commands.run(f"echo {idx}")
                        results[idx] = r.stdout
                    except Exception as e:
                        results[idx] = e

                t1 = threading.Thread(target=worker, args=(0,))
                t2 = threading.Thread(target=worker, args=(1,))
                t1.start()
                t2.start()
                t1.join()
                t2.join()

                # Both must succeed (no 409 from lost-race second refresh)
                for r in results:
                    assert not isinstance(r, Exception), f"expected success, got {r!r}"
                assert results[0] == "ok"
                assert results[1] == "ok"

                # connect() did 1 activate + serialized refreshes added 2
                assert activate_call_count == 3
                assert exec_call_count == 4  # 2 initial 401s + 2 retries
            finally:
                sbx._close_http_client()
