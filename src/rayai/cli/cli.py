#!/usr/bin/env python3
"""RayAI CLI - Run agents and services with Ray Serve

Usage:
    rayai init <project_name> [--type=agent]
    rayai up [--port=8000] [--agents=<names>]
    rayai create-agent <name> [--framework=pydantic|langchain|python]
"""

from importlib.metadata import version

import click

from .commands import analytics, create_agent, init, up


@click.group()
@click.version_option(version=version("rayai"))
def cli():
    """RayAI CLI - Run agents and services with Ray Serve"""
    pass


cli.add_command(init.init)
cli.add_command(up.up)
cli.add_command(create_agent.create_agent)
cli.add_command(analytics.analytics)


def main():
    """Main entry point for the CLI."""
    cli()


if __name__ == "__main__":
    main()
