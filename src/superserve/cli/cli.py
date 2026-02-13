#!/usr/bin/env python3
"""Superserve CLI - CLI and SDK for hosted agent infrastructure

Usage:
    superserve login [--api-key=KEY]
    superserve logout
"""

from importlib.metadata import version

import click

from .commands import login, logout


@click.group()
@click.version_option(version=version("superserve"))
def cli():
    """Superserve CLI - CLI and SDK for hosted agent infrastructure"""
    pass


# Authentication
cli.add_command(login.login)
cli.add_command(logout.logout)


def main():
    """Main entry point for the CLI."""
    cli()


if __name__ == "__main__":
    main()
