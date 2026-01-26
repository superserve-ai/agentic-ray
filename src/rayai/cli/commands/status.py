"""Check project status.

The `rayai status` command shows the status of cloud projects.

Usage:
    rayai status            # List all projects
    rayai status myapp      # Show specific project
    rayai status --json     # Output as JSON
"""

import json
import sys

import click

from rayai.cli.platform.auth import is_authenticated
from rayai.cli.platform.client import PlatformAPIError, PlatformClient
from rayai.cli.platform.types import ProjectResponse


@click.command()
@click.argument("project_name", required=False)
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
def status(project_name: str | None, json_output: bool) -> None:
    """Check project status.

    Shows the status of one or all cloud projects.
    Requires authentication via 'rayai login' first.

    Examples:
        rayai status            # List all projects
        rayai status myapp      # Show specific project
        rayai status --json     # Output as JSON
    """
    if not is_authenticated():
        click.echo("Error: Not logged in. Run 'rayai login' first.", err=True)
        sys.exit(1)

    client = PlatformClient()

    try:
        if project_name:
            projects = [client.get_project(project_name)]
        else:
            projects = client.list_projects()
    except PlatformAPIError as e:
        click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if not projects:
        click.echo("No projects found.")
        click.echo("Deploy agents with 'rayai deploy'")
        return

    if json_output:
        _output_json(projects)
    else:
        _output_table(projects)


def _output_json(projects: list[ProjectResponse]) -> None:
    """Output projects as JSON."""
    output = [
        {
            "id": p.id,
            "name": p.name,
            "status": p.status,
            "url": p.url,
            "agents": [a.name for a in p.agents],
            "mcp_servers": [m.name for m in p.mcp_servers],
            "created_at": p.created_at,
            "updated_at": p.updated_at,
            "error": p.error,
        }
        for p in projects
    ]
    click.echo(json.dumps(output, indent=2))


def _output_table(projects: list[ProjectResponse]) -> None:
    """Output projects as formatted table."""
    status_colors = {
        "running": "green",
        "failed": "red",
        "pending": "yellow",
        "building": "yellow",
        "deploying": "cyan",
        "stopped": "white",
    }

    for p in projects:
        color = status_colors.get(p.status, "white")

        click.echo(f"\n{click.style(p.name, bold=True)}")
        click.echo(f"  Status:  {click.style(p.status, fg=color)}")

        if p.url:
            click.echo(f"  URL:     {p.url}")

        if p.agents:
            agent_names = ", ".join(a.name for a in p.agents)
            click.echo(f"  Agents:  {agent_names}")

        if p.mcp_servers:
            mcp_names = ", ".join(m.name for m in p.mcp_servers)
            click.echo(f"  MCP Servers: {mcp_names}")

        if p.created_at:
            click.echo(f"  Created: {p.created_at}")

        if p.error:
            click.echo(f"  Error:   {click.style(p.error, fg='red')}")

    click.echo()  # Trailing newline
