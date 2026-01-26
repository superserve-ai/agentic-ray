"""Run agents and MCP servers with Ray Serve.

The `rayai up` command discovers and serves all agents and MCP servers
defined in the agents/ and mcp_servers/ directories.

Usage:
    rayai up                        # Serve all agents and MCP servers
    rayai up --port 8080            # Serve on custom port
    rayai up --agents a,b           # Serve specific agents only
    rayai up --servers weather      # Serve specific MCP servers only
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import click
from dotenv import load_dotenv

from rayai.cli.analytics import track

if TYPE_CHECKING:
    from rayai.mcp_serve import MCPServerConfig
    from rayai.serve import AgentConfig


@click.command()
@click.argument("project_path", default=".")
@click.option("--port", default=8000, help="Port to serve on")
@click.option("--host", default="0.0.0.0", help="Host to bind to")
@click.option("--agents", help="Serve specific agents only (comma-separated)")
@click.option("--servers", help="Serve specific MCP servers only (comma-separated)")
def up(
    project_path: str,
    port: int,
    host: str,
    agents: str | None,
    servers: str | None,
) -> None:
    """Run agents and MCP servers.

    Discovers and serves:
      - agent.py files in agents/*/
      - server.py files in mcp_servers/*/

    Examples:
        rayai up                        # Serve everything
        rayai up --port 8080            # Custom port
        rayai up --agents a,b           # Specific agents only
        rayai up --servers weather      # Specific MCP servers only
    """
    project_dir = Path(project_path).resolve()

    _load_env(project_dir)
    _validate_project(project_dir)

    if not _check_dependencies():
        sys.exit(1)

    # Parse filters
    agent_filter = _parse_filter(agents)
    server_filter = _parse_filter(servers)

    # Discover and register
    registered_agents = _discover_agents(project_dir, agent_filter)
    registered_mcp_servers = _discover_mcp_servers(project_dir, server_filter)

    if not registered_agents and not registered_mcp_servers:
        click.echo("Error: No agents or MCP servers found")
        click.echo("Create agents with: rayai create-agent <name>")
        click.echo("Create MCP servers with: rayai create-mcp <name>")
        sys.exit(1)

    # Analytics
    track(
        "cli_up",
        {
            "agent_count": len(registered_agents),
            "mcp_server_count": len(registered_mcp_servers),
        },
    )

    # Start serving
    try:
        _start_serving(registered_agents, registered_mcp_servers, host, port)
    except KeyboardInterrupt:
        click.echo("\nShutting down...")
    except Exception as e:
        click.echo(f"Error: {e}")
        sys.exit(1)


def _load_env(project_dir: Path) -> None:
    """Load environment variables from .env file if present."""
    env_file = project_dir / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        click.echo(f"Loaded environment from {env_file}")


def _validate_project(project_dir: Path) -> None:
    """Validate project directory exists."""
    if not project_dir.exists():
        click.echo(f"Error: Directory not found: {project_dir}")
        sys.exit(1)


def _check_dependencies() -> bool:
    """Check that required dependencies are installed."""
    try:
        import ray  # noqa: F401
        from fastapi import FastAPI  # noqa: F401
        from ray import serve  # noqa: F401

        return True
    except ImportError as e:
        click.echo(f"Missing dependency: {e}")
        click.echo("Install with: pip install 'rayai[serve]'")
        return False


def _parse_filter(value: str | None) -> set[str] | None:
    """Parse comma-separated filter string into a set."""
    if not value:
        return None
    return {item.strip() for item in value.split(",")}


def _discover_agents(
    project_dir: Path,
    filter_set: set[str] | None,
) -> list[AgentConfig]:
    """Discover and import agent modules."""
    from rayai.serve import (
        clear_registered_agents,
        get_registered_agents,
        set_rayai_up_mode,
    )

    agents_dir = project_dir / "agents"
    if not agents_dir.exists():
        return []

    # Enable registration mode
    set_rayai_up_mode(True)
    clear_registered_agents()

    # Add project to path
    if str(project_dir) not in sys.path:
        sys.path.insert(0, str(project_dir))

    # Import agent modules
    for folder in sorted(agents_dir.iterdir()):
        if not folder.is_dir() or folder.name.startswith("__"):
            continue

        if filter_set and folder.name not in filter_set:
            continue

        agent_file = folder / "agent.py"
        if not agent_file.exists():
            continue

        try:
            click.echo(f"Loading agent: {folder.name}")
            _import_module(agent_file, f"agents.{folder.name}.agent")
        except Exception as e:
            click.echo(f"  Error: {e}")

    return get_registered_agents()


def _discover_mcp_servers(
    project_dir: Path,
    filter_set: set[str] | None,
) -> list[MCPServerConfig]:
    """Discover and import MCP server modules."""
    from rayai.mcp_serve import (
        clear_registered_mcp_servers,
        get_registered_mcp_servers,
        set_rayai_mcp_up_mode,
    )

    mcp_dir = project_dir / "mcp_servers"
    if not mcp_dir.exists():
        return []

    # Enable registration mode
    set_rayai_mcp_up_mode(True)
    clear_registered_mcp_servers()

    # Add project to path
    if str(project_dir) not in sys.path:
        sys.path.insert(0, str(project_dir))

    # Import server modules
    for folder in sorted(mcp_dir.iterdir()):
        if not folder.is_dir() or folder.name.startswith("__"):
            continue

        if filter_set and folder.name not in filter_set:
            continue

        server_file = folder / "server.py"
        if not server_file.exists():
            continue

        try:
            click.echo(f"Loading MCP server: {folder.name}")
            _import_module(server_file, f"mcp_servers.{folder.name}.server")
        except Exception as e:
            click.echo(f"  Error: {e}")

    return get_registered_mcp_servers()


def _import_module(file_path: Path, module_name: str) -> None:
    """Import a Python module from file."""
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {file_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)


def _start_serving(
    agents: list[AgentConfig],
    mcp_servers: list[MCPServerConfig],
    host: str,
    port: int,
) -> None:
    """Start Ray Serve with all agents and MCP servers."""
    import ray
    from ray import serve as ray_serve

    from rayai.resource_loader import _parse_memory
    from rayai.serve import _create_agent_deployment

    if not ray.is_initialized():
        ray.init()

    ray_serve.start(http_options={"host": host, "port": port})

    # Deploy agents
    for agent_config in agents:
        deployment = _create_agent_deployment(
            agent=agent_config.agent,
            name=agent_config.name,
            replicas=agent_config.replicas,
            ray_actor_options={
                "num_cpus": agent_config.num_cpus,
                "num_gpus": agent_config.num_gpus,
                "memory": _parse_memory(agent_config.memory),
            },
        )
        ray_serve.run(
            deployment, route_prefix=agent_config.route_prefix, name=agent_config.name
        )

    # Deploy MCP servers
    for mcp_config in mcp_servers:
        deployment = _create_mcp_deployment(
            config=mcp_config,
            ray_serve_module=ray_serve,
            memory_bytes=_parse_memory(mcp_config.memory),
        )
        ray_serve.run(
            deployment, route_prefix=mcp_config.route_prefix, name=mcp_config.name
        )

    # Print endpoints
    display_host = "localhost" if host == "0.0.0.0" else host
    base_url = f"http://{display_host}:{port}"

    click.echo(f"\nServing at {base_url}\n")

    if agents:
        click.echo("  Agents:")
        for agent_config in agents:
            click.echo(f"    - {agent_config.route_prefix}/")
        click.echo()
        click.echo("  Example:")
        click.echo(f"    curl -X POST {base_url}/agents/<agent_name>/ \\")
        click.echo('      -H "Content-Type: application/json" \\')
        click.echo('      -d \'{"query": "Hello"}\'')
        click.echo()

    if mcp_servers:
        click.echo("  MCP Servers:")
        for mcp_config in mcp_servers:
            click.echo(f"    - {base_url}{mcp_config.route_prefix}/mcp")
        click.echo()

    click.echo("  Press Ctrl+C to stop.\n")

    # Block until interrupted
    _wait_forever()

    click.echo("Shutting down...")
    ray_serve.shutdown()


def _create_mcp_deployment(
    config: MCPServerConfig,
    ray_serve_module,
    memory_bytes: int,
):
    """Create a Ray Serve deployment for an MCP server."""
    from contextlib import asynccontextmanager

    from fastapi import FastAPI

    mcp = config.mcp_server

    @asynccontextmanager
    async def lifespan(app: FastAPI, _mcp=mcp):
        app.mount("/", _mcp.streamable_http_app())
        async with _mcp.session_manager.run():
            yield

    fastapi_app = FastAPI(lifespan=lifespan)

    @ray_serve_module.deployment(
        name=f"{config.name}-mcp",
        num_replicas=config.replicas,
        ray_actor_options={
            "num_cpus": config.num_cpus,
            "num_gpus": config.num_gpus,
            "memory": memory_bytes,
        },
    )
    @ray_serve_module.ingress(fastapi_app)
    class MCPDeployment:
        pass

    return MCPDeployment.bind()  # type: ignore[attr-defined]


def _wait_forever() -> None:
    """Block until keyboard interrupt."""
    import time

    try:
        import signal

        signal.pause()
    except AttributeError:
        # Windows doesn't have signal.pause()
        while True:
            time.sleep(1)
