"""Deploy agents and MCP servers to RayAI Cloud.

The `rayai deploy` command packages and deploys agents and MCP servers to
RayAI Cloud. It discovers agents in the agents/ directory and MCP servers
in the mcp_servers/ directory, packages them, and uploads to the Platform
API. After initiating deployment, it directs users to the dashboard to
monitor progress.

Usage:
    rayai deploy                        # Deploy all agents and MCP servers
    rayai deploy --name myapp           # Custom deployment name
    rayai deploy --agents a,b           # Deploy specific agents
    rayai deploy --mcp-servers weather  # Deploy specific MCP servers
    rayai deploy --env-file .env.prod   # Include environment file
"""

import sys
from pathlib import Path
from typing import TYPE_CHECKING

import click
from dotenv import dotenv_values

from rayai.cli.analytics import track
from rayai.cli.platform.auth import is_authenticated
from rayai.cli.platform.client import PlatformAPIError, PlatformClient
from rayai.cli.platform.packaging import package_project

if TYPE_CHECKING:
    pass


@click.command()
@click.argument("project_path", default=".")
@click.option("--agents", help="Deploy specific agents only (comma-separated)")
@click.option(
    "--mcp-servers",
    "mcp_servers",
    help="Deploy specific MCP servers only (comma-separated)",
)
@click.option("--name", help="Project name (defaults to project directory name)")
@click.option("--env", multiple=True, help="Environment variable (KEY=VALUE)")
@click.option("--env-file", type=click.Path(exists=True), help="Path to .env file")
def deploy(
    project_path: str,
    agents: str | None,
    mcp_servers: str | None,
    name: str | None,
    env: tuple[str, ...],
    env_file: str | None,
) -> None:
    """Deploy agents and MCP servers to RayAI Cloud.

    Discovers agents in agents/ and MCP servers in mcp_servers/ directories,
    packages them, and deploys to RayAI Cloud. Requires authentication via
    'rayai login' first.

    Examples:
        rayai deploy                            # Deploy all agents and MCP servers
        rayai deploy --name myapp               # Custom deployment name
        rayai deploy --agents agent1,agent2     # Deploy specific agents only
        rayai deploy --mcp-servers weather      # Deploy specific MCP servers only
        rayai deploy --env API_KEY=xxx          # With environment variable
        rayai deploy --env-file .env.prod       # With env file
    """
    if not is_authenticated():
        click.echo("Error: Not logged in. Run 'rayai login' first.", err=True)
        sys.exit(1)

    project_dir = Path(project_path).resolve()

    if not project_dir.exists():
        click.echo(f"Error: Directory not found: {project_dir}", err=True)
        sys.exit(1)

    # Project name defaults to project directory name
    project_name = name or project_dir.name

    # Collect environment variables
    env_vars: dict[str, str] = {}
    if env_file:
        loaded = dotenv_values(env_file)
        env_vars.update({k: v for k, v in loaded.items() if v is not None})
    for e in env:
        if "=" in e:
            k, v = e.split("=", 1)
            env_vars[k] = v

    # Discover agents and MCP servers
    click.echo("Discovering agents and MCP servers...")
    from rayai.cli.commands.up import _discover_agents, _discover_mcp_servers

    agent_filter = {a.strip() for a in agents.split(",")} if agents else None
    mcp_filter = {m.strip() for m in mcp_servers.split(",")} if mcp_servers else None

    registered_agents = _discover_agents(project_dir, agent_filter)
    registered_mcp_servers = _discover_mcp_servers(project_dir, mcp_filter)

    if not registered_agents and not registered_mcp_servers:
        click.echo("Error: No agents or MCP servers found to deploy.", err=True)
        click.echo("Create agents with: rayai create-agent <name>")
        click.echo("Create MCP servers with: rayai create-mcp <name>")
        sys.exit(1)

    if registered_agents:
        click.echo(f"\nFound {len(registered_agents)} agent(s):")
        for config in registered_agents:
            click.echo(f"  - {config.name} ({config.route_prefix})")

    if registered_mcp_servers:
        click.echo(f"\nFound {len(registered_mcp_servers)} MCP server(s):")
        for mcp_config in registered_mcp_servers:
            click.echo(f"  - {mcp_config.name} ({mcp_config.route_prefix})")

    # Package project
    click.echo("\nPackaging project...")
    try:
        package_path, manifest = package_project(
            project_dir, registered_agents, project_name, registered_mcp_servers
        )
        click.echo(f"Package created: {manifest.checksum[:12]}...")
    except Exception as e:
        click.echo(f"Error packaging project: {e}", err=True)
        sys.exit(1)

    # Deploy to Platform API
    click.echo(f"\nDeploying project '{project_name}' to RayAI Cloud...")
    client = PlatformClient()

    try:
        project = client.create_project(
            project_name, str(package_path), manifest, env_vars
        )
    except PlatformAPIError as e:
        package_path.unlink(missing_ok=True)
        click.echo(f"Error: {e.message}", err=True)
        if e.details:
            click.echo(f"Details: {e.details}", err=True)
        sys.exit(1)
    finally:
        # Clean up temporary package file
        package_path.unlink(missing_ok=True)

    from rayai.cli.platform.config import DASHBOARD_URL

    click.echo(f"Project '{project.name}' submitted.")
    click.echo()
    click.echo("View status on the dashboard: " + click.style(DASHBOARD_URL, fg="cyan"))

    track(
        "cli_deploy",
        {
            "agent_count": len(registered_agents),
            "mcp_server_count": len(registered_mcp_servers),
        },
    )
