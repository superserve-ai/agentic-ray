#!/usr/bin/env python3
"""RayAI CLI - Run agents and services with Ray Serve

Usage:
    rayai init <project_name> [--type=agent]
    rayai up [--port=8000] [--agents=<names>]
    rayai create-agent <name> [--framework=pydantic|langchain|python]
    rayai create-mcp <name>
    rayai login [--api-key=KEY]
    rayai logout
    rayai deploy [--name=NAME] [--agents=<names>]
    rayai status [project_name]
    rayai logs <project_name> [-f]
    rayai delete <project_name>
"""

from importlib.metadata import version

import click

from .commands import (
    analytics,
    create_agent,
    create_mcp,
    delete,
    deploy,
    init,
    login,
    logout,
    logs,
    status,
    up,
)
from .commands.mcp import mcp


@click.group()
@click.version_option(version=version("rayai"))
def cli():
    """RayAI CLI - Run agents and services with Ray Serve"""
    pass


# Local development commands
cli.add_command(init.init)
cli.add_command(up.up)
cli.add_command(create_agent.create_agent)

# MCP commands
cli.add_command(create_mcp.create_mcp)
cli.add_command(mcp)

# Other commands
cli.add_command(analytics.analytics)

# Cloud deployment commands
cli.add_command(login.login)
cli.add_command(logout.logout)
cli.add_command(deploy.deploy)
cli.add_command(status.status)
cli.add_command(logs.logs)
cli.add_command(delete.delete)


def main():
    """Main entry point for the CLI."""
    cli()


if __name__ == "__main__":
    main()
