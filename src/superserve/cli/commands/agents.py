"""CLI commands for managing hosted agents."""

import json
import sys

import click

from ..platform.client import PlatformAPIError, PlatformClient
from ..platform.types import AgentConfig


def format_duration(ms: int) -> str:
    """Format milliseconds as human-readable duration."""
    if ms < 1000:
        return f"{ms}ms"
    seconds = ms / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = seconds / 60
    return f"{minutes:.1f}m"


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
        click.echo(
            "No agents found. Create one with: superserve agents create --name <name>"
        )
        return

    # Print table header
    click.echo(f"{'NAME':<25} {'MODEL':<30} {'STATUS':<10} {'CREATED':<20}")
    click.echo("-" * 85)

    for agent in agent_list:
        created = agent.created_at[:10] if agent.created_at else ""
        model_short = agent.model.replace("claude-", "")[:25]
        click.echo(
            f"{agent.name:<25} {model_short:<30} {agent.status:<10} {created:<20}"
        )


@agents.command("create")
@click.option(
    "--name", required=True, help="Agent name (lowercase, alphanumeric, hyphens)"
)
@click.option("--model", default="claude-sonnet-4-20250514", help="Model to use")
@click.option(
    "--system-prompt", default="", help="System prompt (or @file.txt to read from file)"
)
@click.option(
    "--tools", default="Bash,Read,Write,Glob,Grep", help="Comma-separated list of tools"
)
@click.option("--max-turns", default=10, type=int, help="Maximum conversation turns")
@click.option("--timeout", default=300, type=int, help="Timeout in seconds")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def create_agent(
    name: str,
    model: str,
    system_prompt: str,
    tools: str,
    max_turns: int,
    timeout: int,
    as_json: bool,
):
    """Create a new hosted agent."""
    # Handle @file.txt syntax for system prompt
    if system_prompt.startswith("@"):
        file_path = system_prompt[1:]
        try:
            with open(file_path) as f:
                system_prompt = f.read()
        except FileNotFoundError:
            click.echo(f"Error: File not found: {file_path}", err=True)
            sys.exit(1)

    # Parse tools
    tool_list = [t.strip() for t in tools.split(",") if t.strip()]

    config = AgentConfig(
        name=name,
        model=model,
        system_prompt=system_prompt,
        tools=tool_list,
        max_turns=max_turns,
        timeout_seconds=timeout,
    )

    client = PlatformClient()

    try:
        agent = client.create_agent(config)
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 409:
            click.echo(f"Error: Agent '{name}' already exists", err=True)
        elif e.status_code == 422:
            click.echo(f"Validation error: {e.message}", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if as_json:
        click.echo(json.dumps(agent.model_dump(), indent=2))
    else:
        click.echo(f"Created agent '{agent.name}' ({agent.id})")


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

    click.echo(f"ID:            {agent.id}")
    click.echo(f"Name:          {agent.name}")
    click.echo(f"Model:         {agent.model}")
    click.echo(f"Status:        {agent.status}")
    click.echo(f"Max Turns:     {agent.max_turns}")
    click.echo(f"Timeout:       {agent.timeout_seconds}s")
    click.echo(f"Tools:         {', '.join(agent.tools)}")
    click.echo(f"Created:       {agent.created_at}")
    if agent.system_prompt:
        prompt_preview = agent.system_prompt[:100]
        if len(agent.system_prompt) > 100:
            prompt_preview += "..."
        click.echo(f"System Prompt: {prompt_preview}")


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
