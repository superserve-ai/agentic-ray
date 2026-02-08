#!/usr/bin/env python3
"""Superserve CLI - Production infrastructure for agentic workloads

Usage:
    superserve init <project_name> [--type=agent]
    superserve up [--port=8000] [--agents=<names>]
    superserve create-agent <name> [--framework=pydantic|langchain|python]
    superserve create-mcp <name>
    superserve login [--api-key=KEY]
    superserve logout
    superserve deploy [--name=NAME] [--agents=<names>]
    superserve status [project_name]
    superserve logs <project_name> [-f]
    superserve delete <project_name>
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
from .commands.agents import agents
from .commands.mcp import mcp
from .commands.run import run_agent, runs


@click.group()
@click.version_option(version=version("superserve"))
def cli():
    """Superserve CLI - Production infrastructure for agentic workloads"""
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

# Hosted agents commands
cli.add_command(agents)
cli.add_command(run_agent)
cli.add_command(runs)


def main():
    """Main entry point for the CLI."""
    cli()


if __name__ == "__main__":
    main()
