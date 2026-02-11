#!/usr/bin/env python3
"""Superserve CLI - Production infrastructure for agentic workloads

Usage:
    superserve login [--api-key=KEY]
    superserve logout
    superserve agents create|list|get|delete
    superserve run <agent> <prompt>
    superserve runs list|get
    superserve secrets set|delete|list
"""

from importlib.metadata import version

import click

from .commands import login, logout
from .commands.agents import agents
from .commands.run import run_agent, runs
from .commands.secrets import secrets
from .commands.session import sessions


@click.group()
@click.version_option(version=version("superserve"))
def cli():
    """Superserve CLI - Production infrastructure for agentic workloads"""
    pass


# Authentication
cli.add_command(login.login)
cli.add_command(logout.logout)

# Hosted agents commands
cli.add_command(agents)
cli.add_command(run_agent)
cli.add_command(runs)
cli.add_command(secrets)
cli.add_command(sessions)


def main():
    """Main entry point for the CLI."""
    cli()


if __name__ == "__main__":
    main()
