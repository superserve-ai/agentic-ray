"""CLI command for deploying agents."""

import io
import json
import os
import sys
import tarfile
import tempfile
from pathlib import Path

import click
import yaml

from ..platform.client import PlatformAPIError, PlatformClient
from . import SUPERSERVE_YAML

# Directories and patterns excluded from the tarball
EXCLUDE_DIRS = {
    "__pycache__",
    ".git",
    ".venv",
    "venv",
    "node_modules",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "dist",
    "build",
}

EXCLUDE_FILE_PREFIXES = (".env",)


def _should_exclude(
    path: Path, root: Path, user_ignores: set[str] | None = None
) -> bool:
    """Check if a path should be excluded from the tarball."""
    rel = path.relative_to(root)
    parts = rel.parts

    # Check built-in directory exclusions
    for part in parts:
        if part in EXCLUDE_DIRS or part.endswith(".egg-info"):
            return True

    # Check built-in file exclusions
    if path.is_file() and any(path.name.startswith(p) for p in EXCLUDE_FILE_PREFIXES):
        return True

    # Check user-specified ignore patterns (matched as relative path prefixes)
    if user_ignores:
        rel_str = rel.as_posix()
        for pattern in user_ignores:
            if rel_str == pattern or rel_str.startswith(pattern + "/"):
                return True

    return False


def _make_tarball(project_dir: Path, user_ignores: set[str] | None = None) -> bytes:
    """Package a project directory into a tar.gz in memory."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for item in sorted(project_dir.rglob("*")):
            if _should_exclude(item, project_dir, user_ignores):
                continue
            if item.is_file():
                arcname = str(item.relative_to(project_dir))
                tar.add(item, arcname=arcname)
    return buf.getvalue()


def _load_config(project_dir: Path) -> dict:
    """Load and validate superserve.yaml."""
    config_path = project_dir / SUPERSERVE_YAML
    if not config_path.exists():
        click.echo(
            f"Error: {SUPERSERVE_YAML} not found in current directory.\n"
            "Run 'superserve init' to create one.",
            err=True,
        )
        sys.exit(1)

    with open(config_path) as f:
        config = yaml.safe_load(f)

    if not isinstance(config, dict):
        click.echo(f"Error: {SUPERSERVE_YAML} must be a YAML mapping.", err=True)
        sys.exit(1)

    if "name" not in config:
        click.echo(f"Error: 'name' is required in {SUPERSERVE_YAML}.", err=True)
        sys.exit(1)

    if "command" not in config:
        click.echo(f"Error: 'command' is required in {SUPERSERVE_YAML}.", err=True)
        sys.exit(1)

    return config


@click.command("deploy")
@click.option(
    "--dir",
    "project_dir",
    default=".",
    type=click.Path(exists=True, file_okay=False, resolve_path=True),
    help="Project directory (default: current directory)",
)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def deploy(project_dir: str, as_json: bool):
    """Deploy an agent to Superserve.

    Reads superserve.yaml from the project directory, packages the code,
    and deploys it. If the agent already exists, it is updated.

    \b
    Example:
        superserve deploy
        superserve deploy --dir ./my-agent
    """
    project_path = Path(project_dir)
    config = _load_config(project_path)

    name = config["name"]
    command = config["command"]
    user_ignores = set(config.get("ignore") or [])

    if not as_json:
        click.echo(f"Deploying '{name}'...")

    # Package project as tarball
    tarball_bytes = _make_tarball(project_path, user_ignores)
    size_mb = len(tarball_bytes) / (1024 * 1024)

    if not as_json:
        click.echo(f"  Package size: {size_mb:.1f} MB")

    # Write to temp file for upload
    tarball_path = None
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tmp.write(tarball_bytes)
        tarball_path = tmp.name

    try:
        client = PlatformClient()
        agent = client.deploy_agent(
            name=name,
            command=command,
            config=config,
            tarball_path=tarball_path,
        )
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 422:
            click.echo(f"Validation error: {e.message}", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)
    finally:
        if tarball_path:
            os.unlink(tarball_path)

    if as_json:
        click.echo(json.dumps(agent.model_dump(), indent=2))
    else:
        click.echo(f"\nDeployed '{agent.name}' ({agent.id})")
        if agent.command:
            click.echo(f"  Command: {agent.command}")
        click.echo()
        click.echo(f'Run it with: superserve run {agent.name} "your prompt here"')
        # TODO: Once the build pipeline is wired (Cloud Build → callback),
        # stream or poll build status here so the user sees:
        #   Building... → Deploying... → Ready!
