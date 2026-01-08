"""Deploy MCP servers with Ray Serve.

Create MCP servers using FastMCP and deploy them as scalable HTTP endpoints.
Servers are accessible via Streamable HTTP transport at /{name}/mcp.

Usage:
    1. Create server: rayai create-mcp weather
    2. Edit mcp_servers/weather/server.py
    3. Run: rayai mcp up

API:
    rayai.serve_mcp(mcp, name="weather")  # Deploy MCP server
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Any

_registered_mcp_servers: list[MCPServerConfig] = []
_rayai_mcp_up_mode = False


@dataclass
class MCPServerConfig:
    """Configuration for a registered MCP server."""

    mcp_server: Any  # FastMCP instance
    name: str
    num_cpus: float
    num_gpus: float
    memory: str
    replicas: int
    route_prefix: str


def serve_mcp(
    mcp_server: Any,
    *,
    name: str | None = None,
    num_cpus: float = 0.5,
    num_gpus: float = 0,
    memory: str = "512MB",
    replicas: int = 1,
    route_prefix: str | None = None,
) -> None:
    """Deploy an MCP server on Ray Serve.

    Args:
        mcp_server: FastMCP instance (must use stateless_http=True)
        name: Server name for the endpoint (default: inferred from directory)
        num_cpus: CPUs per replica
        num_gpus: GPUs per replica
        memory: Memory per replica (e.g., "512MB", "2GB")
        replicas: Number of server replicas
        route_prefix: URL prefix (default: /{name}, endpoint: /{name}/mcp)
    """
    if name is None:
        name = _infer_server_name()

    if route_prefix is None:
        route_prefix = f"/{name}"

    config = MCPServerConfig(
        mcp_server=mcp_server,
        name=name,
        num_cpus=num_cpus,
        num_gpus=num_gpus,
        memory=memory,
        replicas=replicas,
        route_prefix=route_prefix,
    )

    if _is_main_context() and not _rayai_mcp_up_mode:
        _start_serving([config])
    else:
        _registered_mcp_servers.append(config)


def run(port: int = 8000, host: str = "0.0.0.0") -> None:
    """Start Ray Serve with all registered MCP servers.

    Args:
        port: Port to serve on (default: 8000)
        host: Host to bind to (default: "0.0.0.0")

    Raises:
        RuntimeError: If no MCP servers are registered
    """
    if not _registered_mcp_servers:
        raise RuntimeError("No MCP servers registered")
    _start_serving(_registered_mcp_servers, port=port, host=host)


def get_registered_mcp_servers() -> list[MCPServerConfig]:
    """Get list of registered MCP server configurations."""
    return _registered_mcp_servers.copy()


def clear_registered_mcp_servers() -> None:
    """Clear the registered MCP servers list."""
    _registered_mcp_servers.clear()


def set_rayai_mcp_up_mode(enabled: bool) -> None:
    """Set whether we're running in rayai mcp up mode.

    When enabled, serve_mcp() registers servers instead of starting immediately.
    """
    global _rayai_mcp_up_mode
    _rayai_mcp_up_mode = enabled


def _is_main_context() -> bool:
    """Check if the caller is running as __main__."""
    frame = sys._getframe(2)
    caller_globals = frame.f_globals
    return caller_globals.get("__name__") == "__main__"


def _infer_server_name() -> str:
    """Infer server name from caller's directory."""
    import os

    frame = sys._getframe(2)
    caller_file: str = frame.f_globals.get("__file__", "unknown")
    parent_dir = os.path.basename(os.path.dirname(os.path.abspath(caller_file)))

    if parent_dir and parent_dir != ".":
        return parent_dir
    return "mcp_server"


def _start_serving(
    configs: list[MCPServerConfig], port: int = 8000, host: str = "0.0.0.0"
) -> None:
    """Start Ray Serve with the given MCP server configurations."""
    from contextlib import asynccontextmanager

    import ray
    from fastapi import FastAPI
    from ray import serve as ray_serve

    from rayai.resource_loader import _parse_memory

    if not ray.is_initialized():
        ray.init()

    ray_serve.start(http_options={"host": host, "port": port})

    for config in configs:
        mcp = config.mcp_server

        @asynccontextmanager
        async def lifespan(app: FastAPI, _mcp=mcp):
            app.mount("/", _mcp.streamable_http_app())
            async with _mcp.session_manager.run():
                yield

        fastapi_app = FastAPI(lifespan=lifespan)

        deployment_name = f"{config.name}-mcp"

        @ray_serve.deployment(
            name=deployment_name,
            num_replicas=config.replicas,
            ray_actor_options={
                "num_cpus": config.num_cpus,
                "num_gpus": config.num_gpus,
                "memory": _parse_memory(config.memory),
            },
        )
        @ray_serve.ingress(fastapi_app)
        class MCPDeployment:
            pass

        ray_serve.run(
            MCPDeployment.bind(),  # type: ignore[attr-defined]
            route_prefix=config.route_prefix,
            name=config.name,
        )

    print("\nMCP servers ready:")
    for config in configs:
        print(f"  - {config.name}: http://{host}:{port}{config.route_prefix}/mcp")
    print("\nPress Ctrl+C to stop.\n")

    try:
        import signal

        signal.pause()
    except (KeyboardInterrupt, AttributeError):
        import time

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    print("\nShutting down...")
    ray_serve.shutdown()
