"""CLI command for initializing a new agent project."""

import sys
from pathlib import Path

import click

from . import SUPERSERVE_YAML

TEMPLATE = """\
# Superserve agent configuration
# Docs: https://docs.superserve.ai

# Agent name (lowercase, alphanumeric, hyphens only)
name: {name}

# Command to start your agent (runs inside the sandbox)
command: python main.py

# Files and directories to exclude from upload
# ignore:
#   - .venv
#   - __pycache__
#   - .git
#   - node_modules
"""


@click.command("init")
@click.option("--name", default=None, help="Agent name (defaults to directory name)")
def init(name: str | None):
    """Initialize a new agent project.

    Creates a superserve.yaml in the current directory.

    \b
    Example:
        superserve init
        superserve init --name my-agent
    """
    config_path = Path.cwd() / SUPERSERVE_YAML
    if config_path.exists():
        click.echo(f"{SUPERSERVE_YAML} already exists.", err=True)
        sys.exit(1)

    if name is None:
        # Default to the current directory name, lowercased and sanitized
        raw = Path.cwd().name.lower()
        name = "".join(c if c.isalnum() or c == "-" else "-" for c in raw)
        # Ensure it starts with a letter
        if name and not name[0].isalpha():
            name = "agent-" + name

    content = TEMPLATE.format(name=name)
    config_path.write_text(content)
    click.echo(f"Created {SUPERSERVE_YAML}")
    click.echo()
    click.echo("Next steps:")
    click.echo(
        f"  1. Set 'command' in {SUPERSERVE_YAML} to the command that starts your agent"
    )
    click.echo("     (e.g., python main.py, node index.js, ./start.sh)")
    click.echo("  2. Set your API keys as secrets:")
    click.echo(f"     superserve secrets set {name} ANTHROPIC_API_KEY=sk-...")
    click.echo("  3. Deploy your agent:")
    click.echo("     superserve deploy")
