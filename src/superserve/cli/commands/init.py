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

{secrets_block}\
# Files and directories to exclude from upload
# ignore:
#   - .venv
#   - __pycache__
#   - .git
#   - node_modules
"""


def _detect_env_keys(project_dir: Path) -> list[str]:
    """Parse variable names from .env.example if it exists."""
    env_example = project_dir / ".env.example"
    if not env_example.exists():
        return []

    keys: list[str] = []
    for line in env_example.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key = line.split("=", 1)[0].strip()
            if key:
                keys.append(key)
    return keys


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
        click.echo(f"{SUPERSERVE_YAML} already exists in this directory.")
        sys.exit(0)

    if name is None:
        # Default to the current directory name, lowercased and sanitized
        raw = Path.cwd().name.lower()
        name = "".join(c if c.isalnum() or c == "-" else "-" for c in raw)
        # Ensure it starts with a letter
        if name and not name[0].isalpha():
            name = "agent-" + name

    # Auto-detect secrets from .env.example, or add commented placeholder
    env_keys = _detect_env_keys(Path.cwd())
    if env_keys:
        lines = "secrets:\n"
        for key in env_keys:
            lines += f"  - {key}\n"
        secrets_block = f"# Environment variables your agent needs to run\n{lines}\n"
    else:
        secrets_block = (
            "# Environment variables your agent needs to run\n"
            "# secrets:\n"
            "#   - ANTHROPIC_API_KEY\n\n"
        )

    content = TEMPLATE.format(name=name, secrets_block=secrets_block)
    config_path.write_text(content)
    click.echo(f"Created {SUPERSERVE_YAML}")
    click.echo()
    click.echo("Next steps:")
    click.echo(
        f"  1. Set 'command' in {SUPERSERVE_YAML} to the command that starts your agent"
    )
    click.echo("     (e.g., python main.py, node index.js, ./start.sh)")
    click.echo("  2. Deploy your agent:")
    click.echo("     superserve deploy")
    if env_keys:
        example_key = env_keys[0]
        click.echo("  3. Set your secrets:")
        click.echo(f"     superserve secrets set {name} {example_key}=...")
    else:
        click.echo("  3. Set your API keys as secrets:")
        click.echo(f"     superserve secrets set {name} ANTHROPIC_API_KEY=sk-...")
    click.echo("  4. Run your agent:")
    click.echo(f'     superserve run {name} "your prompt here"')
