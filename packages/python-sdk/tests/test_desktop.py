"""Tests for sandbox.desktop — RPC shapes, key mapping, batching."""

from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx
from superserve.desktop import (
    AsyncDesktop,
    AsyncDesktopDeps,
    Desktop,
    DesktopDeps,
    _chord_parts,
)

SANDBOX_HOST = "sandbox.example.com"
SBX = "sbx-1"
RPC_BASE = f"https://boxd-{SBX}.{SANDBOX_HOST}/superserve.boxd.v1.DesktopService"


def _make_desktop() -> Desktop:
    deps = DesktopDeps(
        sandbox_id=SBX,
        sandbox_host=SANDBOX_HOST,
        get_access_token=lambda: "tok-initial",
        refresh_activate=lambda: "tok-refreshed",
        publish_stream_port=lambda: None,
        stream_base_url=lambda: f"https://6080-{SBX}.{SANDBOX_HOST}",
    )
    return Desktop(deps)


def _request_body(route: respx.Route) -> dict:
    return json.loads(route.calls.last.request.content)


class TestScreenshot:
    @respx.mock
    def test_decodes_png_and_dimensions(self) -> None:
        png = b"\x89PNG-fake"
        route = respx.post(f"{RPC_BASE}/Screenshot").mock(
            return_value=httpx.Response(
                200,
                json={
                    "image": base64.b64encode(png).decode(),
                    "width": 1280,
                    "height": 800,
                },
            )
        )
        shot = _make_desktop().screenshot()
        assert route.called
        assert shot.data == png
        assert (shot.width, shot.height) == (1280, 800)
        assert route.calls.last.request.headers["X-Access-Token"] == "tok-initial"

    @respx.mock
    def test_missing_image_raises(self) -> None:
        respx.post(f"{RPC_BASE}/Screenshot").mock(
            return_value=httpx.Response(200, json={"width": 1, "height": 1})
        )
        with pytest.raises(ValueError, match="missing image"):
            _make_desktop().screenshot()


class TestPointer:
    @respx.mock
    def test_click_is_single_rpc(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendPointer").mock(
            return_value=httpx.Response(200, json={})
        )
        _make_desktop().click(10, 20)
        assert route.call_count == 1
        assert _request_body(route) == {
            "x": 10,
            "y": 20,
            "button": "POINTER_BUTTON_LEFT",
            "action": "POINTER_ACTION_CLICK",
        }

    @respx.mock
    def test_zero_is_a_valid_coordinate(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendPointer").mock(
            return_value=httpx.Response(200, json={})
        )
        _make_desktop().click(0, 300)
        assert _request_body(route)["x"] == 0

    def test_invalid_coordinates_rejected_locally(self) -> None:
        desktop = _make_desktop()
        with pytest.raises(ValueError, match="Invalid coordinates"):
            desktop.click(-1, 5)
        with pytest.raises(ValueError, match="Invalid coordinates"):
            desktop.move_mouse(1.5, 5)  # type: ignore[arg-type]

    @respx.mock
    def test_drag_is_one_atomic_batch(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendActions").mock(
            return_value=httpx.Response(200, json={"executed": 3})
        )
        _make_desktop().drag((1, 2), (30, 40))
        assert route.call_count == 1
        actions = _request_body(route)["actions"]
        assert [next(iter(a)) for a in actions] == ["pointer", "pointer", "pointer"]
        assert actions[0]["pointer"]["action"] == "POINTER_ACTION_DOWN"
        assert actions[1]["pointer"] == {
            "x": 30,
            "y": 40,
            "button": "POINTER_BUTTON_LEFT",
            "action": "POINTER_ACTION_MOVE",
        }
        assert actions[2]["pointer"]["action"] == "POINTER_ACTION_UP"


class TestKeyboard:
    @respx.mock
    def test_write_sends_literal_text(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendKey").mock(
            return_value=httpx.Response(200, json={})
        )
        _make_desktop().write("hello world")
        assert _request_body(route) == {"text": "hello world"}

    @respx.mock
    def test_write_empty_is_noop(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendKey").mock(
            return_value=httpx.Response(200, json={})
        )
        _make_desktop().write("")
        assert not route.called

    @respx.mock
    def test_press_maps_names_and_chords(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendKey").mock(
            return_value=httpx.Response(200, json={})
        )
        desktop = _make_desktop()
        desktop.press("enter")
        assert _request_body(route) == {"key": "Return", "modifiers": []}
        desktop.press("ctrl+c")
        assert _request_body(route) == {"key": "c", "modifiers": ["ctrl"]}
        desktop.press(["cmd", "shift", "p"])
        assert _request_body(route) == {"key": "p", "modifiers": ["super", "shift"]}

    def test_chord_parts_passthrough_and_empty(self) -> None:
        assert _chord_parts("F5") == ([], "F5")
        with pytest.raises(ValueError, match="empty key"):
            _chord_parts("")


class TestBatchAndMisc:
    @respx.mock
    def test_actions_maps_every_type(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendActions").mock(
            return_value=httpx.Response(200, json={"executed": 3})
        )
        _make_desktop().actions(
            [
                {"type": "click", "x": 5, "y": 6, "button": "right"},
                {"type": "write", "text": "hi"},
                {"type": "scroll", "dy": 3},
            ]
        )
        actions = _request_body(route)["actions"]
        assert actions == [
            {
                "pointer": {
                    "x": 5,
                    "y": 6,
                    "button": "POINTER_BUTTON_RIGHT",
                    "action": "POINTER_ACTION_CLICK",
                }
            },
            {"key": {"text": "hi"}},
            {"scroll": {"dx": 0, "dy": 3}},
        ]

    @respx.mock
    def test_invalid_action_rejects_batch_before_any_request(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendActions").mock(
            return_value=httpx.Response(200, json={})
        )
        with pytest.raises(ValueError, match="Invalid coordinates"):
            _make_desktop().actions(
                [
                    {"type": "click", "x": 1, "y": 1},
                    {"type": "move", "x": -4, "y": 2},
                ]
            )
        assert not route.called

    def test_unknown_action_type_rejected(self) -> None:
        with pytest.raises(ValueError, match="Unknown desktop action"):
            _make_desktop().actions([{"type": "teleport", "x": 1, "y": 1}])

    @respx.mock
    def test_scroll_and_resize(self) -> None:
        scroll = respx.post(f"{RPC_BASE}/Scroll").mock(
            return_value=httpx.Response(200, json={})
        )
        resize = respx.post(f"{RPC_BASE}/Resize").mock(
            return_value=httpx.Response(200, json={})
        )
        desktop = _make_desktop()
        desktop.scroll(dx=-2, dy=5)
        desktop.resize(1024, 768)
        assert _request_body(scroll) == {"dx": -2, "dy": 5}
        assert _request_body(resize) == {"width": 1024, "height": 768}


class TestStreamUrl:
    def test_publishes_and_builds_novnc_url(self) -> None:
        published: list[bool] = []
        deps = DesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=lambda: "tok",
            publish_stream_port=lambda: published.append(True),
            stream_base_url=lambda: f"https://6080-{SBX}.{SANDBOX_HOST}",
        )
        url = Desktop(deps).get_stream_url()
        assert published == [True]
        assert url == (
            f"https://6080-{SBX}.{SANDBOX_HOST}/vnc.html?autoconnect=1&resize=scale"
        )

    def test_view_only_flag(self) -> None:
        url = _make_desktop().get_stream_url(view_only=True)
        assert "view_only=1" in url


class TestTokenRetry:
    @respx.mock
    def test_stale_token_activates_and_retries_once(self) -> None:
        tokens: list[str] = []

        def responder(request: httpx.Request) -> httpx.Response:
            tokens.append(request.headers["X-Access-Token"])
            if len(tokens) == 1:
                return httpx.Response(401, json={"error": "unauthenticated"})
            return httpx.Response(200, json={})

        respx.post(f"{RPC_BASE}/SendPointer").mock(side_effect=responder)
        refreshes: list[bool] = []

        def refresh() -> str:
            refreshes.append(True)
            return "tok-refreshed"

        state = {"token": "tok-initial"}

        def refresh_and_store() -> str:
            state["token"] = refresh()
            return state["token"]

        deps = DesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: state["token"],
            refresh_activate=refresh_and_store,
            publish_stream_port=lambda: None,
            stream_base_url=lambda: "unused",
        )
        Desktop(deps).click(1, 1)
        assert tokens == ["tok-initial", "tok-refreshed"]
        assert refreshes == [True]


class TestAsyncDesktop:
    @respx.mock
    @pytest.mark.asyncio
    async def test_click_and_screenshot(self) -> None:
        pointer = respx.post(f"{RPC_BASE}/SendPointer").mock(
            return_value=httpx.Response(200, json={})
        )
        png = b"png-bytes"
        respx.post(f"{RPC_BASE}/Screenshot").mock(
            return_value=httpx.Response(
                200,
                json={
                    "image": base64.b64encode(png).decode(),
                    "width": 10,
                    "height": 5,
                },
            )
        )

        async def publish() -> None:
            return None

        async def refresh() -> str:
            return "tok"

        deps = AsyncDesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=refresh,
            publish_stream_port=publish,
            stream_base_url=lambda: f"https://6080-{SBX}.{SANDBOX_HOST}",
        )
        desktop = AsyncDesktop(deps)
        await desktop.click(3, 4)
        shot = await desktop.screenshot()
        assert pointer.call_count == 1
        assert shot.data == png
        assert (shot.width, shot.height) == (10, 5)
