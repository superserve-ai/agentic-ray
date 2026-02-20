"""Stream class — output channel for agent responses during a turn."""

from __future__ import annotations

import json
import sys
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from superserve.sdk.session import Session


class Stream:
    """Write agent output during a turn.

    In terminal mode, writes to stdout/stderr.
    In platform mode, writes JSON frames to the protocol channel.
    """

    def __init__(self, mode: str, session: Session | None = None):
        self.mode = mode
        self._session = session

    def _require_session(self) -> Session:
        """Return session or raise if not in platform mode."""
        assert self._session is not None, "Stream requires a session in platform mode"
        return self._session

    def write(self, content: str | Any) -> None:
        """Write text or structured content to the client."""
        if self.mode == "terminal":
            if isinstance(content, str):
                print(content, end="", flush=True)
            else:
                print(json.dumps(content), flush=True)
        else:
            # Ensure content is always a string for the JSON protocol —
            # the runtime accumulates output as a string
            text = content if isinstance(content, str) else json.dumps(content)
            self._require_session()._write_frame({"type": "text", "content": text})

    def status(self, text: str) -> None:
        """Send a transient status message (e.g., 'Searching...')."""
        if self.mode == "terminal":
            print(f"\n[{text}]", file=sys.stderr)
        else:
            self._require_session()._write_frame({"type": "status", "content": text})

    def metadata(self, data: dict[str, Any]) -> None:
        """Send metadata (e.g., cost, turn count). Not shown to user."""
        if self.mode == "platform":
            self._require_session()._write_frame({"type": "metadata", "data": data})
