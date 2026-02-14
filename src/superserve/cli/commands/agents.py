"""CLI commands for managing hosted agents."""

import json
import sys

import click

from ..platform.client import PlatformAPIError, PlatformClient


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
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if as_json:
        click.echo(json.dumps([a.model_dump() for a in agent_list], indent=2))
        return

    if not agent_list:
        click.echo("No agents found. Deploy one with: superserve deploy")
        return

    # Print table header
    click.echo(f"{'NAME':<25} {'COMMAND':<35} {'CREATED':<20}")
    click.echo("-" * 80)

    for agent in agent_list:
        created = agent.created_at[:10] if agent.created_at else ""
        command = agent.command or ""
        if len(command) > 33:
            command = command[:30] + "..."
        click.echo(f"{agent.name:<25} {command:<35} {created:<20}")


@agents.command("get")
@click.argument("name")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def get_agent(name: str, as_json: bool):
    """Get details of a hosted agent."""
    client = PlatformClient()

    try:
        agent = client.get_agent(name)
    except PlatformAPIError as e:
        if e.status_code == 404:
            click.echo(f"Agent '{name}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if as_json:
        click.echo(json.dumps(agent.model_dump(), indent=2))
        return

    click.echo(f"ID:       {agent.id}")
    click.echo(f"Name:     {agent.name}")
    click.echo(f"Command:  {agent.command or '(none)'}")
    click.echo(f"Created:  {agent.created_at}")
    click.echo(f"Updated:  {agent.updated_at}")
    if agent.environment_keys:
        click.echo(f"Secrets:  {', '.join(agent.environment_keys)}")


@agents.command("delete")
@click.argument("name")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
def delete_agent(name: str, yes: bool):
    """Delete a hosted agent."""
    if not yes:
        if not click.confirm(f"Delete agent '{name}'?"):
            click.echo("Cancelled")
            return

    client = PlatformClient()

    try:
        client.delete_agent(name)
    except PlatformAPIError as e:
        if e.status_code == 404:
            click.echo(f"Agent '{name}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    click.echo(f"Deleted agent '{name}'")
