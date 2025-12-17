#!/usr/bin/env python3
"""RayAI CLI - Run agents and services with Ray Serve

Usage:
    rayai init <project_name> [--type=agent]
    rayai serve [--port=8000] [--agent=<name>]
"""

import click

from .commands import analytics, create_agent, init, serve


@click.group()
@click.version_option(version="0.1.0")
def cli():
    """RayAI CLI - Run agents and services with Ray Serve"""
    pass


cli.add_command(init.init)
cli.add_command(serve.serve)
cli.add_command(create_agent.create_agent)
cli.add_command(analytics.analytics)


def main():
    """Main entry point for the CLI."""
    cli()


if __name__ == "__main__":
    main()
