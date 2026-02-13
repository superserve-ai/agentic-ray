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

import sys
from importlib.metadata import version

import click
import requests

from .commands import login, logout
from .commands.agents import agents
from .commands.run import run_agent, runs
from .commands.secrets import secrets
from .commands.session import sessions
from .platform.client import PlatformAPIError


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
    try:
        cli()
    except PlatformAPIError as e:
        click.echo(f"Error: {e.message}", err=True)
        hint = {
            401: "Hint: Run 'superserve login' to authenticate.",
            403: "Hint: You don't have permission for this action.",
            404: "Hint: Run 'superserve agents list' to see your agents.",
            409: "Hint: Use a different name or delete the existing resource first.",
            422: "Hint: Check your input and try again.",
            429: "Hint: Too many requests. Please wait and try again.",
            500: "Hint: This is a server issue. Please try again later.",
            502: "Hint: The server is temporarily unavailable. Please try again later.",
            503: "Hint: The service is temporarily unavailable. Please try again later.",
        }.get(e.status_code)
        if hint:
            click.echo(hint, err=True)
        sys.exit(1)
    except requests.ConnectionError:
        click.echo("Error: Could not connect to Superserve API.", err=True)
        click.echo("Hint: Check your internet connection and try again.", err=True)
        sys.exit(1)
    except requests.Timeout:
        click.echo("Error: Request timed out.", err=True)
        click.echo("Hint: The server may be busy. Please try again.", err=True)
        sys.exit(1)
    except click.Abort:
        click.echo(err=True)
        sys.exit(130)
    except KeyboardInterrupt:
        click.echo(err=True)
        sys.exit(130)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        click.echo(
            "Hint: If this persists, try updating with 'pip install -U superserve'.",
            err=True,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
