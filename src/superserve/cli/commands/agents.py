"""CLI commands for managing hosted agents."""

import json
import sys

import click

from ..platform.client import PlatformAPIError, PlatformClient
from ..utils import format_timestamp, sanitize_terminal_output

_STATUS_LABELS = {
    "none": "Ready",
    "ready": "Ready",
    "installing": "Deploying",
    "failed": "Failed",
}


def _agent_status(deps_status: str) -> str:
    """Map internal deps_status to user-facing label."""
    return _STATUS_LABELS.get(deps_status, deps_status)


def _handle_agent_error(e: PlatformAPIError, name: str | None = None) -> None:
    """Print a user-friendly error for agent operations and exit."""
    if e.status_code == 404 and name:
        click.echo(f"Agent '{name}' not found", err=True)
        click.echo("Hint: Run 'superserve agents list' to see your agents.", err=True)
    elif e.status_code == 401:
        click.echo("Not authenticated. Run 'superserve login' first.", err=True)
    else:
        click.echo(f"Error: {e.message}", err=True)
    sys.exit(1)


@click.group()
def agents():
    """Manage hosted agents."""
    pass


@agents.command("list")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def list_agents(as_json: bool):
    """List all hosted agents."""
    client = PlatformClient()

    try:
        agent_list = client.list_agents()
    except PlatformAPIError as e:
        _handle_agent_error(e)

    if as_json:
        click.echo(json.dumps([a.model_dump() for a in agent_list], indent=2))
        return

    if not agent_list:
        click.echo("No agents found. Deploy one with: superserve deploy")
        return

    click.echo(f"{'NAME':<25} {'ID':<40} {'STATUS':<12} {'CREATED':<20}")
    click.echo("-" * 97)

    for agent in agent_list:
        created = format_timestamp(agent.created_at, short=True)
        name = sanitize_terminal_output(agent.name)
        agent_status = _agent_status(agent.deps_status)
        click.echo(
            f"{name:<25} {sanitize_terminal_output(agent.id):<40} {sanitize_terminal_output(agent_status):<12} {created:<20}"
        )


@agents.command("get")
@click.argument("name")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def get_agent(name: str, as_json: bool):
    """Get details of a hosted agent."""
    client = PlatformClient()

    try:
        agent = client.get_agent(name)
    except PlatformAPIError as e:
        _handle_agent_error(e, name)

    if as_json:
        click.echo(json.dumps(agent.model_dump(), indent=2))
        return

    click.echo(f"ID:       {agent.id}")
    click.echo(f"Name:     {sanitize_terminal_output(agent.name)}")
    click.echo(f"Command:  {sanitize_terminal_output(agent.command or '(none)')}")
    click.echo(
        f"Status:   {sanitize_terminal_output(_agent_status(agent.deps_status))}"
    )
    click.echo(f"Created:  {format_timestamp(agent.created_at)}")
    click.echo(f"Updated:  {format_timestamp(agent.updated_at)}")


@agents.command("delete")
@click.argument("name")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
def delete_agent(name: str, yes: bool):
    """Delete a hosted agent."""
    client = PlatformClient()

    # Verify agent exists before asking for confirmation
    try:
        client.get_agent(name)
    except PlatformAPIError as e:
        _handle_agent_error(e, name)

    if not yes:
        if not click.confirm(f"Delete agent '{name}'?"):
            click.echo("Cancelled")
            return

    try:
        client.delete_agent(name)
    except PlatformAPIError as e:
        _handle_agent_error(e, name)

    click.echo(f"Deleted agent '{name}'")
