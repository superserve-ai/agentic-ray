"""CLI commands for session management.

Sessions are created automatically when using 'superserve run'.
This group provides management commands for listing, inspecting,
ending, and resuming sessions.
"""

import json
import signal
import sys

import click

from ..platform.client import PlatformAPIError, PlatformClient
from ..utils import (
    Spinner,
    format_relative_time,
    format_timestamp,
    sanitize_terminal_output,
)


@click.group()
def sessions():
    """Manage agent sessions (list, inspect, end)."""
    pass


@sessions.command("list")
@click.argument("agent", required=False, default=None)
@click.option("--status", "filter_status", default=None, help="Filter by status")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def list_sessions(agent, filter_status, as_json):
    """List sessions.

    Optionally filter by AGENT name or ID.

    Examples:
        superserve sessions list
        superserve sessions list simple-agent
        superserve sessions list --status idle
    """
    client = PlatformClient()
    try:
        session_list = client.list_sessions(agent_id=agent, status=filter_status)
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        else:
            click.echo(f"Error: {sanitize_terminal_output(e.message)}", err=True)
        sys.exit(1)
    if as_json:
        click.echo(json.dumps(session_list, default=str))
        return
    if not session_list:
        click.echo("No sessions found.")
        return

    if agent:
        # Filtered by agent — omit AGENT column, wider TITLE
        click.echo(
            f"{'ID':<14} {'TITLE':<32} {'STATUS':<12} {'MSGS':<6} {'LAST ACTIVE':<14}"
        )
        click.echo("-" * 78)
        for s in session_list:
            sid_short = s["id"].replace("ses_", "").replace("-", "")[:12]
            title = sanitize_terminal_output(s.get("title") or "")
            if len(title) > 30:
                title = title[:27] + "..."
            active = format_relative_time(str(s.get("last_activity_at", "")))
            click.echo(
                f"{sid_short:<14} {title:<32} {s.get('status', '?'):<12}"
                f" {s.get('message_count', 0):<6} {active:<14}"
            )
    else:
        # Unfiltered — show AGENT column
        click.echo(
            f"{'ID':<14} {'AGENT':<18} {'TITLE':<24} {'STATUS':<12}"
            f" {'MSGS':<6} {'LAST ACTIVE':<14}"
        )
        click.echo("-" * 88)
        for s in session_list:
            sid_short = s["id"].replace("ses_", "").replace("-", "")[:12]
            agent_display = sanitize_terminal_output(
                s.get("agent_name") or s.get("agent_id", "?")
            )
            if len(agent_display) > 16:
                agent_display = agent_display[:13] + "..."
            title = sanitize_terminal_output(s.get("title") or "")
            if len(title) > 22:
                title = title[:19] + "..."
            active = format_relative_time(str(s.get("last_activity_at", "")))
            click.echo(
                f"{sid_short:<14} {agent_display:<18} {title:<24}"
                f" {s.get('status', '?'):<12}"
                f" {s.get('message_count', 0):<6} {active:<14}"
            )


@sessions.command("get")
@click.argument("session_id")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def get_session(session_id, as_json):
    """Get session details."""
    client = PlatformClient()
    try:
        session = client.get_session(session_id)
    except PlatformAPIError as e:
        click.echo(f"Error: {sanitize_terminal_output(e.message)}", err=True)
        if e.status_code == 404:
            click.echo(
                "Hint: Run 'superserve sessions list' to see your sessions.",
                err=True,
            )
        elif e.status_code == 409:
            click.echo("Hint: Use more characters to narrow it down.", err=True)
        sys.exit(1)
    if as_json:
        click.echo(json.dumps(session, default=str))
    else:
        click.echo(f"Session: {session['id']}")
        if session.get("title"):
            title = sanitize_terminal_output(session["title"])
            click.echo(f"  Title:    {title}")
        agent_name = session.get("agent_name")
        agent_id = session.get("agent_id")
        if agent_name and agent_id:
            agent_display = f"{sanitize_terminal_output(agent_name)} ({agent_id})"
        else:
            agent_display = sanitize_terminal_output(agent_name or agent_id or "?")
        click.echo(f"  Agent:    {agent_display}")
        click.echo(f"  Status:   {session.get('status', '?')}")
        click.echo(f"  Messages: {session.get('message_count', 0)}")
        click.echo(f"  Created:  {format_timestamp(session.get('created_at', ''))}")
        last_active = session.get("last_activity_at", "")
        if last_active:
            relative = format_relative_time(str(last_active))
            absolute = format_timestamp(str(last_active))
            click.echo(f"  Active:   {relative} ({absolute})")


@sessions.command("end")
@click.argument("session_id")
def end_session(session_id):
    """End an active session."""
    client = PlatformClient()
    try:
        session = client.end_session(session_id)
    except PlatformAPIError as e:
        click.echo(f"Error: {sanitize_terminal_output(e.message)}", err=True)
        if e.status_code == 404:
            click.echo(
                "Hint: Run 'superserve sessions list' to see your sessions.",
                err=True,
            )
        elif e.status_code == 409:
            click.echo("Hint: Use more characters to narrow it down.", err=True)
        sys.exit(1)
    click.echo(f"Session {session_id} ended (status: {session.get('status', '?')})")


@sessions.command("resume")
@click.argument("session_id")
def resume_session(session_id):
    """Resume a previous session.

    Reconnects to an idle, completed, or failed session, restoring
    the workspace filesystem. Starts an interactive conversation loop.

    Examples:
        superserve sessions resume 8ff75147
        superserve sessions resume ses_8ff75147-...
    """
    client = PlatformClient()
    spinner: Spinner | None = None
    use_spinner = sys.stderr.isatty()

    def handle_interrupt(signum, frame):
        if spinner:
            spinner.stop()
        click.echo("\nCancelled.", err=True)
        sys.exit(130)

    signal.signal(signal.SIGINT, handle_interrupt)

    from .run import _stream_events

    try:
        session = client.resume_session(session_id)

        title = session.get("title") or "Untitled"
        agent_name = session.get("agent_name") or session.get("agent_id", "?")
        click.echo(
            f'Resumed: "{sanitize_terminal_output(title)}"'
            f" ({sanitize_terminal_output(agent_name)})",
            err=True,
        )

        full_session_id = session["id"]

        if use_spinner:
            spinner = Spinner(show_elapsed=True)

        # Interactive loop
        while True:
            try:
                prompt = click.prompt("\nYou", prompt_suffix="> ")
            except (EOFError, click.Abort):
                click.echo()
                break
            stripped = prompt.strip()
            if not stripped or stripped.lower() == "exit":
                break

            if spinner:
                spinner.start()

            exit_code = _stream_events(
                client.stream_session_message(full_session_id, prompt),
                as_json=False,
                spinner=spinner,
            )
            if exit_code:
                sys.exit(exit_code)

    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 409:
            click.echo(f"Error: {sanitize_terminal_output(e.message)}", err=True)
        elif e.status_code == 404:
            click.echo(f"Session '{session_id}' not found.", err=True)
            click.echo(
                "Hint: Run 'superserve sessions list' to see your sessions.",
                err=True,
            )
        else:
            click.echo(f"Error: {sanitize_terminal_output(e.message)}", err=True)
        sys.exit(1)
    finally:
        if spinner:
            spinner.stop()
