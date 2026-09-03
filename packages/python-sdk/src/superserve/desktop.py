"""``sandbox.desktop`` - control a GUI desktop inside a sandbox.

Requires a desktop-enabled template (one whose image runs an X server and
exposes boxd's DesktopService). Every action is a single authenticated
data-plane RPC: a coordinate click is one round trip, a drag is one batched
request, and typing has no artificial per-character pacing.

A paused sandbox is transparently resumed on first use, like ``commands``
and ``files``.
"""

from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlencode

import httpx

from ._config import data_plane_target
from ._http import api_request, async_api_request
from ._token_retry import async_with_token_retry, with_token_retry

_RPC_BASE = "/superserve.boxd.v1.DesktopService"

#: Port the desktop template serves noVNC (websockify) on.
DESKTOP_STREAM_PORT = 6080

MouseButton = Literal["left", "right", "middle"]

_BUTTONS: dict[str, str] = {
    "left": "POINTER_BUTTON_LEFT",
    "right": "POINTER_BUTTON_RIGHT",
    "middle": "POINTER_BUTTON_MIDDLE",
}

# Friendly key names -> X keysyms, so agent-facing code can say "enter" or
# "ctrl". Unlisted names pass through verbatim (all X keysyms stay usable).
_KEYSYMS: dict[str, str] = {
    "enter": "Return",
    "return": "Return",
    "esc": "Escape",
    "escape": "Escape",
    "tab": "Tab",
    "space": "space",
    "backspace": "BackSpace",
    "delete": "Delete",
    "insert": "Insert",
    "up": "Up",
    "down": "Down",
    "left": "Left",
    "right": "Right",
    "home": "Home",
    "end": "End",
    "pageup": "Page_Up",
    "pagedown": "Page_Down",
    "ctrl": "ctrl",
    "control": "ctrl",
    "alt": "alt",
    "shift": "shift",
    "cmd": "super",
    "win": "super",
    "super": "super",
}


@dataclass(frozen=True)
class Screenshot:
    """A captured frame: PNG bytes plus the display dimensions."""

    data: bytes
    width: int
    height: int


@dataclass(frozen=True)
class DesktopDeps:
    """Internal deps from Sandbox. ``refresh_activate`` is invoked on 401."""

    sandbox_id: str
    sandbox_host: str
    get_access_token: Callable[[], str]
    refresh_activate: Callable[[], str]
    publish_stream_port: Callable[[], None]
    stream_base_url: Callable[[], str]


@dataclass(frozen=True)
class AsyncDesktopDeps:
    """Async variant of DesktopDeps."""

    sandbox_id: str
    sandbox_host: str
    get_access_token: Callable[[], str]
    refresh_activate: Callable[[], Awaitable[str]]
    publish_stream_port: Callable[[], Awaitable[None]]
    stream_base_url: Callable[[], str]


def _keysym(key: str) -> str:
    return _KEYSYMS.get(key.lower(), key)


def _chord_parts(key: str | Sequence[str]) -> tuple[list[str], str]:
    """Split a chord into (modifiers, final key) for the KeyEvent RPC.

    ``press("ctrl+c")`` and ``press(["ctrl", "c"])`` are equivalent.
    """
    parts = [_keysym(p) for p in (key.split("+") if isinstance(key, str) else key)]
    if not parts or any(p == "" for p in parts):
        raise ValueError("press: empty key")
    return parts[:-1], parts[-1]


def _assert_coordinate(x: int, y: int) -> None:
    # 0 is a valid coordinate — validate explicitly, never with truthiness.
    if not isinstance(x, int) or not isinstance(y, int) or x < 0 or y < 0:
        raise ValueError(f"Invalid coordinates ({x}, {y}): must be integers >= 0")


def _pointer_body(x: int, y: int, action: str, button: MouseButton = "left") -> dict:
    _assert_coordinate(x, y)
    return {"x": x, "y": y, "button": _BUTTONS[button], "action": action}


def _action_body(action: dict[str, Any]) -> dict[str, Any]:
    """Lower one ``desktop.actions()`` step into its proto-JSON shape."""
    kind = action.get("type")
    if kind == "click":
        return {
            "pointer": _pointer_body(
                action["x"],
                action["y"],
                "POINTER_ACTION_CLICK",
                action.get("button", "left"),
            )
        }
    if kind == "double_click":
        return {
            "pointer": _pointer_body(
                action["x"], action["y"], "POINTER_ACTION_DOUBLE_CLICK"
            )
        }
    if kind == "move":
        return {
            "pointer": _pointer_body(action["x"], action["y"], "POINTER_ACTION_MOVE")
        }
    if kind == "mouse_down":
        return {
            "pointer": _pointer_body(
                action["x"],
                action["y"],
                "POINTER_ACTION_DOWN",
                action.get("button", "left"),
            )
        }
    if kind == "mouse_up":
        return {
            "pointer": _pointer_body(
                action["x"],
                action["y"],
                "POINTER_ACTION_UP",
                action.get("button", "left"),
            )
        }
    if kind == "press":
        modifiers, final_key = _chord_parts(action["key"])
        return {"key": {"key": final_key, "modifiers": modifiers}}
    if kind == "write":
        return {"key": {"text": action["text"]}}
    if kind == "scroll":
        return {"scroll": {"dx": action.get("dx", 0), "dy": action.get("dy", 0)}}
    raise ValueError(f"Unknown desktop action type: {kind!r}")


def _decode_screenshot(raw: dict[str, Any]) -> Screenshot:
    image = raw.get("image")
    if image is None:
        raise ValueError("Screenshot response missing image data")
    return Screenshot(
        data=base64.b64decode(image),
        width=raw.get("width", 0),
        height=raw.get("height", 0),
    )


def _stream_url(base: str, *, view_only: bool) -> str:
    params: dict[str, str] = {"autoconnect": "1", "resize": "scale"}
    if view_only:
        params["view_only"] = "1"
    return f"{base}/vnc.html?{urlencode(params)}"


class Desktop:
    """Sync desktop control. Access as ``sandbox.desktop``."""

    def __init__(self, deps: DesktopDeps, client: httpx.Client | None = None) -> None:
        self._deps = deps
        self._client = client
        target = data_plane_target(deps.sandbox_id, deps.sandbox_host)
        self._data_plane_base_url = target.url
        self._routing_headers = target.headers

    def screenshot(self) -> Screenshot:
        """Capture the current screen as a PNG.

        One round trip; safe to call while a live stream viewer is open.
        """
        return _decode_screenshot(self._rpc("Screenshot", {}))

    def click(self, x: int, y: int, *, button: MouseButton = "left") -> None:
        """Click at (x, y). One RPC — move and click are a single action."""
        self._rpc("SendPointer", _pointer_body(x, y, "POINTER_ACTION_CLICK", button))

    def double_click(self, x: int, y: int) -> None:
        """Double-click at (x, y)."""
        self._rpc("SendPointer", _pointer_body(x, y, "POINTER_ACTION_DOUBLE_CLICK"))

    def right_click(self, x: int, y: int) -> None:
        """Right-click at (x, y)."""
        self.click(x, y, button="right")

    def middle_click(self, x: int, y: int) -> None:
        """Middle-click at (x, y)."""
        self.click(x, y, button="middle")

    def move_mouse(self, x: int, y: int) -> None:
        """Move the pointer to (x, y) without clicking."""
        self._rpc("SendPointer", _pointer_body(x, y, "POINTER_ACTION_MOVE"))

    def drag(
        self,
        start: tuple[int, int],
        end: tuple[int, int],
        *,
        button: MouseButton = "left",
    ) -> None:
        """Drag from ``start`` to ``end`` as one atomic batch (down-move-up)
        under the sandbox's input lock, so no other input can interleave."""
        self.actions(
            [
                {"type": "mouse_down", "x": start[0], "y": start[1], "button": button},
                {"type": "move", "x": end[0], "y": end[1]},
                {"type": "mouse_up", "x": end[0], "y": end[1], "button": button},
            ]
        )

    def scroll(self, *, dx: int = 0, dy: int = 0) -> None:
        """Scroll under the pointer. Positive ``dy`` scrolls down, negative
        up; ``dx`` scrolls horizontally. Both axes in one call."""
        self._rpc("Scroll", {"dx": dx, "dy": dy})

    def write(self, text: str) -> None:
        """Type literal text. Fast by default — no per-character pacing."""
        if not text:
            return
        self._rpc("SendKey", {"text": text})

    def press(self, key: str | Sequence[str]) -> None:
        """Press a key or chord: ``press("enter")``, ``press("ctrl+c")``,
        ``press(["ctrl", "shift", "p"])``. Friendly names map to X keysyms;
        unrecognized names pass through verbatim."""
        modifiers, final_key = _chord_parts(key)
        self._rpc("SendKey", {"key": final_key, "modifiers": modifiers})

    def actions(self, actions: Sequence[dict[str, Any]]) -> None:
        """Execute an ordered batch of actions in a single request.

        The whole batch is validated before anything runs, then executed
        under the sandbox's input lock. Execution stops at the first failing
        action. This is the fast path for models that emit several actions
        per turn.

        Example::

            sandbox.desktop.actions([
                {"type": "click", "x": 640, "y": 32},
                {"type": "write", "text": "https://example.com"},
                {"type": "press", "key": "enter"},
            ])
        """
        if not actions:
            return
        self._rpc("SendActions", {"actions": [_action_body(a) for a in actions]})

    def resize(self, width: int, height: int) -> None:
        """Resize the virtual display. Width must be a multiple of 8 between
        320 and 8192; height between 200 and 8192. Takes effect live."""
        self._rpc("Resize", {"width": width, "height": height})

    def get_stream_url(self, *, view_only: bool = False) -> str:
        """Publish the live desktop viewer (noVNC) and return its browser URL.

        The URL goes through the sandbox's preview-port access policy — under
        a private policy, viewers also need a preview token.
        """
        self._deps.publish_stream_port()
        return _stream_url(self._deps.stream_base_url(), view_only=view_only)

    def _rpc(self, method: str, body: dict[str, Any]) -> dict[str, Any]:
        def send(token: str) -> Any:
            return api_request(
                "POST",
                f"{self._data_plane_base_url}{_RPC_BASE}/{method}",
                headers={**self._routing_headers, "X-Access-Token": token},
                json_body=body,
                client=self._client,
            )

        return with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )


class AsyncDesktop:
    """Async desktop control. Access as ``sandbox.desktop``."""

    def __init__(
        self, deps: AsyncDesktopDeps, client: httpx.AsyncClient | None = None
    ) -> None:
        self._deps = deps
        self._client = client
        target = data_plane_target(deps.sandbox_id, deps.sandbox_host)
        self._data_plane_base_url = target.url
        self._routing_headers = target.headers

    async def screenshot(self) -> Screenshot:
        """Async variant of :meth:`Desktop.screenshot`."""
        return _decode_screenshot(await self._rpc("Screenshot", {}))

    async def click(self, x: int, y: int, *, button: MouseButton = "left") -> None:
        """Async variant of :meth:`Desktop.click`."""
        await self._rpc(
            "SendPointer", _pointer_body(x, y, "POINTER_ACTION_CLICK", button)
        )

    async def double_click(self, x: int, y: int) -> None:
        """Async variant of :meth:`Desktop.double_click`."""
        await self._rpc(
            "SendPointer", _pointer_body(x, y, "POINTER_ACTION_DOUBLE_CLICK")
        )

    async def right_click(self, x: int, y: int) -> None:
        """Async variant of :meth:`Desktop.right_click`."""
        await self.click(x, y, button="right")

    async def middle_click(self, x: int, y: int) -> None:
        """Async variant of :meth:`Desktop.middle_click`."""
        await self.click(x, y, button="middle")

    async def move_mouse(self, x: int, y: int) -> None:
        """Async variant of :meth:`Desktop.move_mouse`."""
        await self._rpc("SendPointer", _pointer_body(x, y, "POINTER_ACTION_MOVE"))

    async def drag(
        self,
        start: tuple[int, int],
        end: tuple[int, int],
        *,
        button: MouseButton = "left",
    ) -> None:
        """Async variant of :meth:`Desktop.drag`."""
        await self.actions(
            [
                {"type": "mouse_down", "x": start[0], "y": start[1], "button": button},
                {"type": "move", "x": end[0], "y": end[1]},
                {"type": "mouse_up", "x": end[0], "y": end[1], "button": button},
            ]
        )

    async def scroll(self, *, dx: int = 0, dy: int = 0) -> None:
        """Async variant of :meth:`Desktop.scroll`."""
        await self._rpc("Scroll", {"dx": dx, "dy": dy})

    async def write(self, text: str) -> None:
        """Async variant of :meth:`Desktop.write`."""
        if not text:
            return
        await self._rpc("SendKey", {"text": text})

    async def press(self, key: str | Sequence[str]) -> None:
        """Async variant of :meth:`Desktop.press`."""
        modifiers, final_key = _chord_parts(key)
        await self._rpc("SendKey", {"key": final_key, "modifiers": modifiers})

    async def actions(self, actions: Sequence[dict[str, Any]]) -> None:
        """Async variant of :meth:`Desktop.actions`."""
        if not actions:
            return
        await self._rpc("SendActions", {"actions": [_action_body(a) for a in actions]})

    async def resize(self, width: int, height: int) -> None:
        """Async variant of :meth:`Desktop.resize`."""
        await self._rpc("Resize", {"width": width, "height": height})

    async def get_stream_url(self, *, view_only: bool = False) -> str:
        """Async variant of :meth:`Desktop.get_stream_url`."""
        await self._deps.publish_stream_port()
        return _stream_url(self._deps.stream_base_url(), view_only=view_only)

    async def _rpc(self, method: str, body: dict[str, Any]) -> dict[str, Any]:
        async def send(token: str) -> Any:
            return await async_api_request(
                "POST",
                f"{self._data_plane_base_url}{_RPC_BASE}/{method}",
                headers={**self._routing_headers, "X-Access-Token": token},
                json_body=body,
                client=self._client,
            )

        return await async_with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )
