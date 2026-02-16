"""Shared utility functions for CLI commands."""

import re
import sys
import threading
import time
from datetime import datetime


def format_timestamp(ts: str, short: bool = False) -> str:
    """Format ISO timestamp to readable local time.

    Args:
        ts: ISO 8601 timestamp string.
        short: If True, omit seconds (for list views).

    Returns:
        Formatted local time string.
    """
    if not ts:
        return ""
    try:
        utc = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        local = utc.astimezone()
        if short:
            return local.strftime("%b %d %H:%M")
        return local.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return ts[:16]


def format_duration(ms: int) -> str:
    """Format milliseconds as human-readable duration.

    Args:
        ms: Duration in milliseconds.

    Returns:
        Human-readable duration string (e.g., "500ms", "1.5s", "2.0m").
    """
    if ms < 1000:
        return f"{ms}ms"
    seconds = ms / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = seconds / 60
    return f"{minutes:.1f}m"


def format_elapsed(seconds: float) -> str:
    """Format elapsed seconds as human-readable duration.

    Args:
        seconds: Elapsed time in seconds.

    Returns:
        Human-readable duration string (e.g., "45s", "2m 30s").
    """
    secs = int(seconds)
    if secs < 60:
        return f"{secs}s"
    return f"{secs // 60}m {secs % 60}s"


# Regex pattern to match ANSI escape sequences
# This covers CSI sequences (most common), OSC sequences, and other control sequences
_ANSI_ESCAPE_PATTERN = re.compile(
    r"""
    \x1b          # ESC character
    (?:
        \[        # CSI (Control Sequence Introducer)
        [0-?]*    # Parameter bytes
        [ -/]*    # Intermediate bytes
        [@-~]     # Final byte
        |
        \]        # OSC (Operating System Command)
        .*?       # Content
        (?:\x07|\x1b\\)  # String terminator (BEL or ESC \)
        |
        [PX^_]    # DCS, SOS, PM, APC
        .*?       # Content
        \x1b\\    # String terminator
        |
        [NO]      # SS2, SS3
        .         # Single character
        |
        [()*/+]   # Designate character set
        .         # Charset selector
        |
        [=>]      # Application/Normal keypad mode
        |
        c         # RIS (Reset to Initial State)
    )
    """,
    re.VERBOSE,
)


class Spinner:
    """Animated terminal spinner for long-running operations.

    Displays a Braille-character spinner on stderr with a status message.
    Thread-based so it doesn't block the main event loop.

    Args:
        show_elapsed: If True, show elapsed time next to the status text.
        indent: Number of leading spaces before the spinner character.
    """

    _FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    _INTERVAL = 0.08  # seconds between frames

    def __init__(self, show_elapsed: bool = False, indent: int = 0):
        self._text = ""
        self._running = False
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._start_time = 0.0
        self._show_elapsed = show_elapsed
        self._prefix = " " * indent

    def start(self, text: str = "") -> None:
        """Start the spinner with the given status text."""
        with self._lock:
            self._text = text
            if self._running:
                return
            self._running = True
            self._start_time = time.monotonic()
        self._thread = threading.Thread(target=self._animate, daemon=True)
        self._thread.start()

    def update(self, text: str) -> None:
        """Update the status text while spinning."""
        with self._lock:
            self._text = text

    def _stop_thread(self) -> None:
        """Stop the animation thread."""
        with self._lock:
            if not self._running:
                return
            self._running = False
        if self._thread:
            self._thread.join(timeout=0.2)
            self._thread = None

    def stop(self) -> None:
        """Stop the spinner and clear the line. Idempotent."""
        self._stop_thread()
        sys.stderr.write("\r\033[K")
        sys.stderr.flush()

    def done(self, symbol: str = "\u2713", suffix: str = "") -> None:
        """Stop the spinner and persist the line with a symbol."""
        self._stop_thread()
        text = f"\r\033[K{self._prefix}{symbol} {self._text}"
        if suffix:
            text += f" {suffix}"
        sys.stderr.write(text + "\n")
        sys.stderr.flush()

    def fail(self, suffix: str = "") -> None:
        """Stop the spinner and persist the line with a failure symbol."""
        self.done(symbol="\u2717", suffix=suffix)

    def _animate(self) -> None:
        idx = 0
        while True:
            with self._lock:
                if not self._running:
                    break
                text = self._text
                elapsed = time.monotonic() - self._start_time
            frame = self._FRAMES[idx % len(self._FRAMES)]
            line = f"\r\033[K{self._prefix}{frame} {text}"
            if self._show_elapsed:
                line += f" \033[2m{format_elapsed(elapsed)}\033[0m"
            sys.stderr.write(line)
            sys.stderr.flush()
            idx += 1
            time.sleep(self._INTERVAL)


def sanitize_terminal_output(text: str) -> str:
    """Remove ANSI escape sequences from text to prevent terminal injection.

    LLM output may contain ANSI escape sequences (either from prompt injection
    or legitimate code output). These sequences can manipulate the terminal
    display in potentially harmful ways (e.g., clearing the screen, moving
    cursor, changing colors to hide text).

    Args:
        text: Text that may contain ANSI escape sequences.

    Returns:
        Text with all ANSI escape sequences removed.
    """
    return _ANSI_ESCAPE_PATTERN.sub("", text)
