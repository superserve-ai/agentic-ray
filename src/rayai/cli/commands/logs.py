"""Stream logs from deployed agents.

The `rayai logs` command retrieves and streams logs from cloud projects.

Usage:
    rayai logs myapp              # Show recent logs
    rayai logs myapp -f           # Follow/stream logs
    rayai logs myapp --tail 50    # Last 50 lines
    rayai logs myapp --agent foo  # Logs from specific agent
"""

import sys

import click

from rayai.cli.analytics import track
from rayai.cli.platform.auth import is_authenticated
from rayai.cli.platform.client import PlatformAPIError, PlatformClient
from rayai.cli.platform.types import LogEntry


@click.command()
@click.argument("project_name")
@click.option("--follow", "-f", is_flag=True, help="Follow log output")
@click.option("--tail", "-n", default=100, help="Number of lines to show")
@click.option("--agent", help="Show logs for specific agent")
def logs(project_name: str, follow: bool, tail: int, agent: str | None) -> None:
    """Stream logs from deployed agents.

    Retrieves logs from a cloud project. Use --follow to stream
    logs in real-time.

    Examples:
        rayai logs myapp              # Show recent logs
        rayai logs myapp -f           # Follow/stream logs
        rayai logs myapp --tail 50    # Last 50 lines
        rayai logs myapp --agent foo  # Logs from specific agent
    """
    if not is_authenticated():
        click.echo("Error: Not logged in. Run 'rayai login' first.", err=True)
        sys.exit(1)

    client = PlatformClient()

    try:
        if follow:
            _stream_logs(client, project_name, agent)
        else:
            _get_logs(client, project_name, tail, agent)
        track("cli_logs", {"follow": follow})
    except PlatformAPIError as e:
        click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)


def _get_logs(client: PlatformClient, name: str, tail: int, agent: str | None) -> None:
    """Get recent logs.

    Args:
        client: Platform API client.
        name: Project name.
        tail: Number of lines to retrieve.
        agent: Filter by agent name.
    """
    entries = client.get_logs(name, tail, agent)

    if not entries:
        click.echo("No logs found.")
        return

    for entry in entries:
        _print_log_entry(entry)


def _stream_logs(client: PlatformClient, name: str, agent: str | None) -> None:
    """Stream logs in real-time.

    Args:
        client: Platform API client.
        name: Project name.
        agent: Filter by agent name.
    """
    click.echo(f"Streaming logs for {name}... (Ctrl+C to stop)\n")

    try:
        for entry in client.stream_logs(name, agent):
            _print_log_entry(entry)
    except KeyboardInterrupt:
        click.echo("\nStopped.")


def _print_log_entry(entry: LogEntry) -> None:
    """Format and print a log entry.

    Args:
        entry: Log entry to print.
    """
    level_colors = {
        "INFO": "blue",
        "WARN": "yellow",
        "WARNING": "yellow",
        "ERROR": "red",
        "DEBUG": "white",
        "CRITICAL": "red",
    }

    level = entry.level.upper()
    color = level_colors.get(level, "white")

    parts = [f"[{entry.timestamp}]"]
    if entry.agent:
        parts.append(f"[{entry.agent}]")
    parts.append(click.style(level, fg=color) + ":")

    prefix = " ".join(parts)
    click.echo(f"{prefix} {entry.message}")
