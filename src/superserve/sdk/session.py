"""Session class — manages the turn loop between runtime and agent."""

import asyncio
import json
import logging
import os
import sys
from typing import TextIO

from superserve.sdk.stream import Stream

_logger = logging.getLogger("superserve.sdk")


class Session:
    """Represents an agent session. Yields messages and streams per turn."""

    def __init__(self, mode: str):
        self.mode = mode  # "terminal" or "platform"
        self.id = os.environ.get("SUPERSERVE_SESSION_ID", "local")
        self._real_stdout: TextIO | None = None

        if mode == "platform":
            self._setup_platform_io()
            self._send_ready()

    def _setup_platform_io(self) -> None:
        """Redirect sys.stdout to stderr so print() doesn't break the JSON protocol."""
        self._real_stdout = sys.stdout
        sys.stdout = sys.stderr

    def _send_ready(self) -> None:
        """Signal to runtime that the agent is ready to receive messages."""
        self._write_frame({"type": "ready"})

    def _write_frame(self, data: dict) -> None:
        """Write a JSON frame to the real stdout (protocol channel)."""
        if self._real_stdout is None:
            return  # terminal mode — no protocol channel
        self._real_stdout.write(json.dumps(data) + "\n")
        self._real_stdout.flush()

    async def turns(self):
        """Async iterator yielding (message, stream) for each turn.

        In terminal mode, reads from input(). In platform mode, reads JSON
        frames from stdin and emits turn_done when the developer's code
        loops back.
        """
        if self.mode == "terminal":
            async for item in self._terminal_turns():
                yield item
        else:
            async for item in self._platform_turns():
                yield item

    async def _terminal_turns(self):
        """Terminal mode: read from input(), write via print()."""
        loop = asyncio.get_event_loop()
        while True:
            try:
                message = (await loop.run_in_executor(None, input, "\nYou: ")).strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not message or message.lower() in ("exit", "quit", "q"):
                break
            stream = Stream(mode="terminal")
            yield message, stream
            print()  # newline after agent response

    async def _platform_turns(self):
        """Platform mode: read JSON from stdin, write JSON to stdout."""
        loop = asyncio.get_event_loop()
        while True:
            # Read from stdin without blocking the event loop
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                # EOF — runtime closed stdin, session is ending
                break
            line = line.strip()
            if not line:
                continue
            try:
                frame = json.loads(line)
            except json.JSONDecodeError:
                _logger.warning("Received non-JSON frame from runtime: %s", line[:200])
                continue
            frame_type = frame.get("type")
            if frame_type == "message":
                stream = Stream(mode="platform", session=self)
                yield frame["content"], stream
                # Developer's code has looped back — turn is done
                self._write_frame({"type": "turn_done"})
            else:
                _logger.debug("Ignoring unknown frame type: %s", frame_type)
