"""App class — entry point for Superserve agents."""

import asyncio
import os
from collections.abc import Callable, Coroutine
from typing import Any

from superserve.sdk.session import Session


class App:
    """Superserve application. Registers a session handler and runs it."""

    def __init__(self, name: str):
        self.name = name
        self._session_handler: Callable[[Session], Coroutine[Any, Any, None]] | None = (
            None
        )

    def session(
        self, func: Callable[[Session], Coroutine[Any, Any, None]]
    ) -> Callable[[Session], Coroutine[Any, Any, None]]:
        """Decorator to register the session handler.

        Usage:
            @app.session
            async def run(session):
                async for message, stream in session.turns():
                    stream.write(f"Echo: {message}")
        """
        self._session_handler = func
        return func

    def run(self) -> None:
        """Start the app. Detects environment and runs in the appropriate mode.

        - Terminal mode (default): interactive stdin/stdout
        - Platform mode (SUPERSERVE=1): JSON protocol on stdin/stdout
        """
        if self._session_handler is None:
            raise RuntimeError(
                "No session handler registered. Use @app.session to register one."
            )

        handler = self._session_handler
        mode = "platform" if os.environ.get("SUPERSERVE") == "1" else "terminal"
        asyncio.run(self._run_session(mode, handler))

    async def _run_session(
        self,
        mode: str,
        handler: Callable[[Session], Coroutine[Any, Any, None]],
    ) -> None:
        """Create a session in the given mode and run the handler."""
        session = Session(mode=mode)
        await handler(session)
