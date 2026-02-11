"""CLI commands for session management."""

import sys

import click

from ..platform.client import PlatformAPIError, PlatformClient
from ..utils import sanitize_terminal_output


@click.group()
def sessions():
    """Manage agent sessions (multi-turn conversations)."""
    pass


@sessions.command("start")
@click.argument("agent")
@click.option("--title", "-t", default=None, help="Session title")
@click.option("--timeout", default=1800, type=int, help="Idle timeout in seconds")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def start_session(agent, title, timeout, as_json):
    """Start a new session with an agent."""
    client = PlatformClient()
    try:
        session = client.create_session(
            agent, title=title, idle_timeout_seconds=timeout
        )
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 404:
            click.echo(f"Agent '{agent}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)
    if as_json:
        import json

        click.echo(json.dumps(session, default=str))
    else:
        click.echo(f"Session started: {session['id']}")
        click.echo(f"  Agent: {session['agent_id']}")
        click.echo(f"  Status: {session['status']}")
        if session.get("title"):
            click.echo(f"  Title: {session['title']}")


@sessions.command("send")
@click.argument("session_id")
@click.argument("prompt")
def send_message(session_id, prompt):
    """Send a message to an active session."""
    client = PlatformClient()
    try:
        for event in client.stream_session_message(session_id, prompt):
            if event.type == "message.delta":
                content = event.data.get("content", "")
                click.echo(sanitize_terminal_output(content), nl=False)
            elif event.type == "run.completed":
                click.echo()  # Final newline
            elif event.type == "run.failed":
                error = event.data.get("error", {})
                click.echo(
                    f"\nError: {error.get('message', 'Unknown error')}", err=True
                )
                sys.exit(1)
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 404:
            click.echo(f"Session '{session_id}' not found", err=True)
        elif e.status_code == 409:
            click.echo(f"Session is not active: {e.message}", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)


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
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)
    if as_json:
        import json

        click.echo(json.dumps(session_list, default=str))
        return
    if not session_list:
        click.echo("No sessions found")
        return
    for s in session_list:
        status_icon = {"active": "●", "idle": "○", "completed": "✓", "failed": "✗"}.get(
            s.get("status", ""), "?"
        )
        click.echo(
            f"  {status_icon} {s['id']}  {s.get('status', '?'):10}  msgs={s.get('message_count', 0)}  agent={s.get('agent_id', '?')}"
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
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 404:
            click.echo(f"Session '{session_id}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)
    if as_json:
        import json

        click.echo(json.dumps(session, default=str))
    else:
        click.echo(f"Session: {session['id']}")
        click.echo(f"  Agent:    {session.get('agent_id', '?')}")
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
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 404:
            click.echo(f"Session '{session_id}' not found", err=True)
        elif e.status_code == 409:
            click.echo(f"Session already ended: {e.message}", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)
    click.echo(f"Session {session_id} ended (status: {session.get('status', '?')})")
