"""CLI commands for session management.

Sessions are created automatically when using 'superserve run'.
This group provides management commands for listing, inspecting, and ending sessions.
"""

import sys

import click

from ..platform.client import PlatformAPIError, PlatformClient
from ..utils import sanitize_terminal_output


@click.group()
def sessions():
    """Manage agent sessions (list, inspect, end)."""
    pass


@sessions.command("list")
@click.option("--agent", default=None, help="Filter by agent name or ID")
@click.option("--status", "filter_status", default=None, help="Filter by status")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def list_sessions(agent, filter_status, as_json):
    """List sessions."""
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
        import json

        click.echo(json.dumps(session_list, default=str))
        return
    if not session_list:
        click.echo("No sessions found.")
        return

    click.echo(f"{'ID':<14} {'AGENT':<20} {'STATUS':<12} {'MSGS':<6} {'CREATED':<20}")
    click.echo("-" * 72)

    for s in session_list:
        sid_clean = s["id"].replace("ses_", "").replace("-", "")
        # First 12 hex chars of UUID (no dashes) — matches Docker/Git short ID convention
        sid_short = sid_clean[:12]
        agent_display = sanitize_terminal_output(
            s.get("agent_name") or s.get("agent_id", "?")
        )
        created = str(s.get("created_at", ""))[:16]
        click.echo(
            f"{sid_short:<14} {agent_display:<20} {s.get('status', '?'):<12} {s.get('message_count', 0):<6} {created:<20}"
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
        import json

        click.echo(json.dumps(session, default=str))
    else:
        click.echo(f"Session: {session['id']}")
        agent_name = session.get("agent_name")
        agent_id = session.get("agent_id")
        if agent_name and agent_id:
            agent_display = f"{sanitize_terminal_output(agent_name)} ({agent_id})"
        else:
            agent_display = sanitize_terminal_output(agent_name or agent_id or "?")
        click.echo(f"  Agent:    {agent_display}")
        click.echo(f"  Status:   {session.get('status', '?')}")
        click.echo(f"  Messages: {session.get('message_count', 0)}")
        click.echo(f"  Created:  {session.get('created_at', '?')}")
        if session.get("title"):
            click.echo(f"  Title:    {session['title']}")


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
