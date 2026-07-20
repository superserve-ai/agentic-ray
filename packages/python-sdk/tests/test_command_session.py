"""Tests for full-duplex command sessions (commands.spawn)."""

from __future__ import annotations

import asyncio
import json

import pytest
import websockets

from superserve.command_session import (
    _STDIN_CHUNK_BYTES,
    AsyncSpawnDeps,
    spawn_command,
)
from superserve.errors import SandboxError

_EOF = object()


class FakeConnection:
    """Stand-in for a websockets client connection driven by the test."""

    def __init__(self, uri: str, subprotocols: list[str]) -> None:
        self.uri = uri
        self.subprotocols = subprotocols
        self.sent: list[object] = []
        self.closed = False
        self._queue: asyncio.Queue = asyncio.Queue()

    async def send(self, data: object) -> None:
        self.sent.append(data)

    async def close(self) -> None:
        self.closed = True
        self._queue.put_nowait(_EOF)

    def __aiter__(self) -> "FakeConnection":
        return self

    async def __anext__(self) -> object:
        item = await self._queue.get()
        if item is _EOF:
            raise StopAsyncIteration
        return item

    # --- test drivers ---
    def feed(self, message: object) -> None:
        self._queue.put_nowait(message)

    def feed_eof(self) -> None:
        self._queue.put_nowait(_EOF)


def make_deps(refresh_activate=None) -> AsyncSpawnDeps:
    token = {"value": "tok-initial"}

    async def default_refresh() -> str:
        token["value"] = "tok-refreshed"
        return "tok-refreshed"

    return AsyncSpawnDeps(
        sandbox_id="sbx-1",
        sandbox_host="sandbox.example.com",
        get_access_token=lambda: token["value"],
        refresh_activate=refresh_activate or default_refresh,
    )


def patch_connect(monkeypatch, connector):
    monkeypatch.setattr(websockets, "connect", connector)


async def test_dials_and_sends_start_frame(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    session = await spawn_command(make_deps(), "echo hi", cwd="/app")
    c = conns[-1]

    assert c.uri == "wss://boxd-sbx-1.sandbox.example.com/exec/connect"
    assert c.subprotocols == ["superserve.exec.v1", "token.tok-initial"]
    assert json.loads(c.sent[0]) == {"command": "echo hi", "working_dir": "/app"}

    c.feed('{"finished":true,"exit_code":0}')
    await session.wait()


async def test_streams_output_and_resolves_result(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    out: list[str] = []
    err: list[str] = []
    session = await spawn_command(
        make_deps(), "run", on_stdout=out.append, on_stderr=err.append
    )
    c = conns[-1]

    c.feed(bytes([0x01]) + b"hi\n")
    c.feed(bytes([0x02]) + b"oops")
    c.feed('{"finished":true,"exit_code":7}')

    result = await session.wait()
    assert out == ["hi\n"]
    assert err == ["oops"]
    assert result.stdout == "hi\n"
    assert result.stderr == "oops"
    assert result.exit_code == 7


async def test_stdin_and_control_frames(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    session = await spawn_command(make_deps(), "cat")
    c = conns[-1]
    c.sent.clear()  # drop the start frame

    await session.stdin.write("ab")
    await session.stdin.close()
    await session.kill("SIGINT")

    assert c.sent[0] == bytes([0x00]) + b"ab"
    assert json.loads(c.sent[1]) == {"type": "stdin_close"}
    assert json.loads(c.sent[2]) == {"type": "signal", "name": "SIGINT"}

    await session.close()


async def test_stdin_write_chunks_large_payloads(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    session = await spawn_command(make_deps(), "cat")
    c = conns[-1]
    c.sent.clear()  # drop the start frame

    payload = b"x" * (3 * _STDIN_CHUNK_BYTES + 100)
    await session.stdin.write(payload)

    assert len(c.sent) == -(-len(payload) // _STDIN_CHUNK_BYTES)
    assert all(f[0] == 0x00 for f in c.sent)
    assert all(len(f) <= _STDIN_CHUNK_BYTES + 1 for f in c.sent)
    assert b"".join(bytes(f[1:]) for f in c.sent) == payload

    await session.close()


async def test_decodes_multibyte_rune_split_across_frames(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    out: list[str] = []
    session = await spawn_command(make_deps(), "emit", on_stdout=out.append)
    c = conns[-1]

    # "é" (U+00E9) is 0xC3 0xA9 — split across two stdout frames.
    c.feed(bytes([0x01, 0xC3]))
    c.feed(bytes([0x01, 0xA9]))
    c.feed('{"finished":true,"exit_code":0}')

    result = await session.wait()
    assert out == ["é"]
    assert result.stdout == "é"


async def test_closes_socket_after_finish(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    session = await spawn_command(make_deps(), "run")
    c = conns[-1]
    c.feed('{"finished":true,"exit_code":0}')
    await session.wait()

    # The reader closes the socket once the command finishes.
    for _ in range(50):
        if c.closed:
            break
        await asyncio.sleep(0)
    assert c.closed


async def test_replaces_invalid_utf8(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    out: list[str] = []
    session = await spawn_command(make_deps(), "emit", on_stdout=out.append)
    c = conns[-1]

    # 0xFF is never valid UTF-8 — it must become U+FFFD, not crash the session.
    c.feed(bytes([0x01, 0xFF]))
    c.feed('{"finished":true,"exit_code":0}')

    result = await session.wait()
    assert out == ["�"]
    assert result.stdout == "�"


async def test_close_before_finish_settles_wait(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    session = await spawn_command(make_deps(), "run")
    await session.close()

    # The finally in the read loop settles wait() even though close() cancelled
    # the reader — it must raise, not hang (wait_for guards against a hang).
    with pytest.raises(SandboxError):
        await asyncio.wait_for(session.wait(), timeout=1.0)


async def test_wait_raises_if_closed_before_finished(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    session = await spawn_command(make_deps(), "run")
    c = conns[-1]
    c.feed(bytes([0x01]) + b"hi")
    c.feed_eof()

    with pytest.raises(SandboxError):
        await session.wait()


async def test_resumes_and_retries_once_on_dial_failure(monkeypatch):
    conns: list[FakeConnection] = []
    attempts = {"n": 0}

    async def connect(uri, subprotocols=None):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise OSError("handshake rejected")
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    refreshed = {"called": False}

    async def refresh() -> str:
        refreshed["called"] = True
        return "tok-refreshed"

    session = await spawn_command(make_deps(refresh), "run")

    assert refreshed["called"]
    assert attempts["n"] == 2
    assert conns[-1].subprotocols == ["superserve.exec.v1", "token.tok-refreshed"]

    conns[-1].feed('{"finished":true,"exit_code":0}')
    await session.wait()


async def test_propagates_when_retry_dial_also_fails(monkeypatch):
    attempts = {"n": 0}

    async def connect(uri, subprotocols=None):
        attempts["n"] += 1
        raise OSError("handshake rejected")

    patch_connect(monkeypatch, connect)

    refreshed = {"n": 0}

    async def refresh() -> str:
        refreshed["n"] += 1
        return "tok-refreshed"

    with pytest.raises(OSError):
        await spawn_command(make_deps(refresh), "run")

    assert refreshed["n"] == 1
    assert attempts["n"] == 2  # one retry, no loop


async def test_server_error_frame_to_stderr(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    session = await spawn_command(make_deps(), "run")
    conns[-1].feed('{"error":"boom","code":"exec_failed","finished":true}')

    result = await session.wait()
    assert result.stderr == "boom"
    assert result.exit_code == 0


async def test_stdin_kill_noop_after_close(monkeypatch):
    conns: list[FakeConnection] = []

    async def connect(uri, subprotocols=None):
        c = FakeConnection(uri, subprotocols)
        conns.append(c)
        return c

    patch_connect(monkeypatch, connect)

    session = await spawn_command(make_deps(), "run")
    c = conns[-1]
    await session.close()
    c.sent.clear()  # drop the SIGTERM close() sent

    await session.stdin.write("x")
    await session.stdin.close()
    await session.kill()

    assert c.sent == []
