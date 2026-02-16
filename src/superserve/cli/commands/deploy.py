"""CLI command for deploying agents."""

import io
import json
import sys
import tarfile
import tempfile
import time
from pathlib import Path

import click
import yaml

from ..platform.client import PlatformAPIError, PlatformClient
from ..utils import Spinner, format_elapsed
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

    try:
        with open(config_path) as f:
            config = yaml.safe_load(f)
    except PermissionError:
        click.echo(f"Error: Permission denied reading {SUPERSERVE_YAML}.", err=True)
        sys.exit(1)
    except yaml.YAMLError as e:
        click.echo(f"Error: Invalid YAML in {SUPERSERVE_YAML}:\n  {e}", err=True)
        sys.exit(1)

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


def _format_size(size_bytes: int) -> str:
    """Format byte count as human-readable size."""
    if size_bytes >= 100 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / 1024:.0f} KB"


def _write_temp_tarball(tarball_bytes: bytes) -> str:
    """Write tarball bytes to a temporary file and return the path."""
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tmp.write(tarball_bytes)
        return tmp.name


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

    if as_json:
        tarball_bytes = _make_tarball(project_path, user_ignores)
        tarball_path = _write_temp_tarball(tarball_bytes)
        try:
            client = PlatformClient()
            agent = client.deploy_agent(
                name=name, command=command, config=config, tarball_path=tarball_path
            )
        except PlatformAPIError as e:
            click.echo(json.dumps({"error": e.message}), err=True)
            sys.exit(1)
        finally:
            Path(tarball_path).unlink(missing_ok=True)
        click.echo(json.dumps(agent.model_dump(), indent=2))
        return

    click.echo()
    deploy_start = time.time()

    # ── Package ──
    status = Spinner(indent=2)
    status.start("Packaging project...")
    tarball_bytes = _make_tarball(project_path, user_ignores)
    status.done(suffix=f"({_format_size(len(tarball_bytes))})")

    # ── Upload ──
    status.start("Uploading to Superserve...")
    tarball_path = _write_temp_tarball(tarball_bytes)

    try:
        client = PlatformClient()
        agent = client.deploy_agent(
            name=name,
            command=command,
            config=config,
            tarball_path=tarball_path,
        )
        status.done()
    except PlatformAPIError as e:
        status.fail()
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 422:
            click.echo(f"Validation error: {e.message}", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)
    finally:
        Path(tarball_path).unlink(missing_ok=True)

    # ── Dependencies ──
    if agent.deps_status == "installing":
        status.start("Installing dependencies...")
        poll_interval = 3
        max_wait = 300
        elapsed = 0
        deps_start = time.time()

        while elapsed < max_wait:
            time.sleep(poll_interval)
            elapsed += poll_interval

            try:
                agent = client.get_agent(name)
            except PlatformAPIError as e:
                status.fail()
                click.echo(f"Error checking status: {e.message}", err=True)
                click.echo(f"Check manually: superserve agents get {name}", err=True)
                sys.exit(1)

            if agent.deps_status == "ready":
                deps_time = format_elapsed(time.time() - deps_start)
                status.done(suffix=f"({deps_time})")
                break
            elif agent.deps_status == "failed":
                status.fail()
                if agent.deps_error:
                    click.echo(f"  {agent.deps_error}", err=True)
                click.echo(err=True)
                click.echo(
                    "Agent created but dependencies failed to install.", err=True
                )
                click.echo("Fix your requirements and run: superserve deploy", err=True)
                sys.exit(1)
        else:
            status.fail(suffix="(timed out)")
            click.echo(
                "\nDependency install is still running. Check status with:", err=True
            )
            click.echo(f"  superserve agents get {name}", err=True)
            sys.exit(1)

    # ── Done ──
    total_time = format_elapsed(time.time() - deploy_start)
    click.echo()
    click.echo(f"  Deployed '{agent.name}' in {total_time}")

    # ── Secrets ──
    required = config.get("secrets") or []
    if required:
        missing = [s for s in required if s not in agent.environment_keys]
        if missing:
            click.echo()
            click.echo("  Set your secrets before running:")
            for key in missing:
                click.echo(f"    superserve secrets set {name} {key}=...")
    elif not agent.environment_keys:
        click.echo()
        click.echo("  Set your API keys as secrets:")
        click.echo(f"    superserve secrets set {name} KEY=VALUE")

    click.echo()
    click.echo(f'  superserve run {agent.name} "your prompt here"')
    click.echo()
