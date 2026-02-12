"""Shared utility functions for CLI commands."""

import re


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


def echo_truncated(text: str, label: str, max_len: int, full: bool) -> None:
    """Echo text with optional truncation and a label.

    Args:
        text: The text to display.
        label: Label to show before the text (e.g., "Prompt", "Output").
        max_len: Maximum length before truncation.
        full: If True, show full text without truncation.
    """
    import click

    click.echo(f"\n{label}:")

    if not full and len(text) > max_len:
        click.echo(f"  {text[:max_len]}")
        click.echo(f"  ... ({len(text)} chars, use --full to see all)")
    else:
        click.echo(f"  {text}")
