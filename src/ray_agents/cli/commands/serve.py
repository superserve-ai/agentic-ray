"""Serve projects locally with Ray Serve."""

import importlib.util
import inspect
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import click
from dotenv import load_dotenv

from ray_agents.deployment import (
    create_agent_deployment,
)
from ray_agents.resource_loader import (
    _parse_memory,
    merge_resource_configs,
)

RESOURCE_TYPES = ["num-cpus", "memory", "num-replicas", "num-gpus"]
DEFAULT_RESOURCES = {"num_cpus": 1, "memory": "2GB", "num_replicas": 1, "num_gpus": 0}


@click.command(
    context_settings={"allow_extra_args": True, "allow_interspersed_args": False}
)
@click.argument("project_path", default=".")
@click.option("--port", default=8000, help="Port to serve on")
@click.option("--agents", help="Run specific agents (comma-separated)")
@click.pass_context
def serve(ctx, project_path: str, port: int, agents: str):
    """Serve agents using Ray Serve."""
    project_dir = Path(project_path).resolve()

    # Load environment variables from .env file
    env_file = project_dir / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        click.echo(f"Loaded environment from {env_file}")

    if not project_dir.exists():
        click.echo(f"Error: Project directory not found: {project_dir}")
        return

    cli_resources = _parse_resource_flags(ctx.args)

    if not _ensure_dependencies():
        return

    agents_dict = _discover_agents(project_dir)
    if not agents_dict:
        click.echo("Error: No agents found")
        click.echo("Create agents/ directory with Agent classes")
        return

    agents_to_deploy = _select_agents(agents_dict, agents)
    if not agents_to_deploy:
        return

    _deploy_agents(agents_to_deploy, port, cli_resources)


def _parse_flag_name(flag_name: str) -> tuple[str | None, str | None]:
    """Parse flag name to extract agent name and resource type.

    Args:
        flag_name: Flag name like "chatbot-num-cpus"

    Returns:
        Tuple of (agent_name, resource_type) or (None, None) if invalid
    """
    for rt in RESOURCE_TYPES:
        if flag_name.endswith(f"-{rt}"):
            agent_name = flag_name[: -len(f"-{rt}")]
            return agent_name, rt
    return None, None


def _parse_resource_value(
    resource_type: str, value: str, flag_name: str
) -> int | str | None:
    """Parse resource value based on type.

    Args:
        resource_type: Type of resource (e.g., "num-cpus", "memory")
        value: String value to parse
        flag_name: Full flag name for error messages

    Returns:
        Parsed value or None if invalid
    """
    try:
        if resource_type in ["num-cpus", "num-replicas", "num-gpus"]:
            return int(value)
        else:
            return value
    except ValueError:
        expected_type = (
            "integer"
            if resource_type in ["num-cpus", "num-replicas", "num-gpus"]
            else "string"
        )
        click.echo(
            f"Warning: Invalid value '{value}' for {flag_name}, expected {expected_type}"
        )
        return None


def _parse_resource_flags(extra_args: list[str]) -> dict[str, dict[str, Any]]:
    """
    Parse CLI resource flags with format --{agent-name}-{resource-type}={value}.

    Args:
        extra_args: List of extra CLI arguments

    Returns:
        Dict mapping agent names to their resource configurations
    """
    cli_resources: dict[str, dict[str, Any]] = {}

    for arg in extra_args:
        if not arg.startswith("--") or "=" not in arg:
            if arg.startswith("--") and "=" not in arg:
                click.echo(
                    f"Warning: Ignoring invalid resource flag '{arg}' (missing =value)"
                )
            continue

        flag_name, value = arg[2:].split("=", 1)
        agent_name, resource_type = _parse_flag_name(flag_name)

        if agent_name is None or resource_type is None:
            continue

        parsed_value = _parse_resource_value(resource_type, value, flag_name)
        if parsed_value is None:
            continue

        resource_key = resource_type.replace("-", "_")
        if agent_name not in cli_resources:
            cli_resources[agent_name] = {}
        cli_resources[agent_name][resource_key] = parsed_value

    return cli_resources


def _ensure_dependencies() -> bool:
    """Ensure Ray Serve dependencies are available."""
    try:
        import ray  # noqa: F401
        from fastapi import FastAPI  # noqa: F401
        from pydantic import BaseModel  # noqa: F401
        from ray import serve  # noqa: F401

        click.echo("Ray Serve dependencies available")
    except ImportError:
        click.echo("Installing Ray Serve dependencies...")
        try:
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pip",
                    "install",
                    "ray[serve]",
                    "fastapi",
                    "uvicorn",
                ],
                check=True,
                capture_output=True,
            )
            click.echo("Ray Serve dependencies installed")
        except subprocess.CalledProcessError as e:
            click.echo(f"Failed to install Ray Serve: {e}")
            return False

    return True


def _discover_agents(project_dir: Path) -> dict[str, Any]:
    """Discover Agent classes in the agents/ directory."""
    agents: dict[str, Any] = {}
    agents_dir = project_dir / "agents"

    if not agents_dir.exists() or not agents_dir.is_dir():
        return agents

    for agent_folder in agents_dir.iterdir():
        if not agent_folder.is_dir() or agent_folder.name.startswith("__"):
            continue

        agent_file = agent_folder / "agent.py"
        if not agent_file.exists():
            click.echo(f"Warning: No agent.py found in {agent_folder.name}, skipping")
            continue

        agent_name = agent_folder.name
        agent_class = _load_agent_from_file(agent_file, f"agents.{agent_name}.agent")
        if agent_class:
            agents[agent_name] = {"class": agent_class, "file": agent_file}
        else:
            click.echo(f"Warning: No Agent class found in {agent_name}/agent.py")

    return agents


def _load_agent_from_file(file_path: Path, module_name: str) -> Any | None:
    """Load Agent class from a Python file.

    Discovers classes decorated with @agent.
    """
    try:
        project_dir = file_path.parent.parent
        if str(project_dir) not in sys.path:
            sys.path.insert(0, str(project_dir))

        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            click.echo(f"Failed to create module spec for {file_path}")
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        for _name, obj in inspect.getmembers(module):
            # Check if class is decorated with @agent
            is_agent = getattr(obj, "_is_rayai_agent", False)

            if is_agent:
                is_defined_here = (
                    obj.__module__ == module.__name__ if inspect.isclass(obj) else False
                )
                if is_defined_here:
                    return obj

        click.echo(f"No @agent decorated class found in {file_path}")
        click.echo("  Agent classes must be decorated with @agent:")
        click.echo("    from ray_agents import agent")
        click.echo("    @agent()")
        click.echo("    class MyAgent:")
        click.echo("        def run(self, data: dict) -> dict: ...")
        return None

    except Exception as e:
        click.echo(f"Failed to load agent from {file_path}: {e}")
        return None


def _select_agents(all_agents: dict[str, Any], agents: str) -> dict[str, Any]:
    """Select which agents to deploy."""
    if not agents:
        return all_agents

    agent_names = [name.strip() for name in agents.split(",")]
    selected = {}
    for name in agent_names:
        if name in all_agents:
            selected[name] = all_agents[name]
        else:
            click.echo(f"Agent '{name}' not found, skipping")
    return selected


def _merge_all_resource_sources(
    agent_class: Any,
    agent_name: str,
    cli_resources: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """
    Merge resources from all sources with precedence: CLI > @agent decorator > defaults.

    Args:
        agent_class: Agent class (decorated with @agent)
        agent_name: Name of the agent
        cli_resources: Parsed CLI resource flags

    Returns:
        Final merged resource configuration
    """
    # Get resources from @agent decorator metadata
    agent_metadata = getattr(agent_class, "_agent_metadata", {})
    cli_flags = cli_resources.get(agent_name, {})
    merged = merge_resource_configs(DEFAULT_RESOURCES, agent_metadata, cli_flags)

    sources = []
    if agent_metadata:
        sources.append("@agent decorator")
    if cli_flags:
        sources.append(f"CLI flags {list(cli_flags.keys())}")

    if sources:
        click.echo(f"   Resource sources: {', '.join(sources)}")
    else:
        click.echo("   Using default resources")

    click.echo(f"   Final resources: {merged}")

    return merged


def _initialize_ray_serve(port: int):
    """Initialize Ray and Ray Serve.

    Args:
        port: Port for Ray Serve HTTP server
    """
    import ray
    from ray import serve

    click.echo("Initializing Ray...")

    if not ray.is_initialized():
        ray.init(ignore_reinit_error=True)

    serve.start(detached=True, http_options={"host": "0.0.0.0", "port": port})


def _create_deployment(
    agent_name: str,
    agent_class: Any,
    resources: dict[str, Any],
):
    """Create Ray Serve deployment for an agent.

    Args:
        agent_name: Name of the agent
        agent_class: Agent class to deploy
        resources: Resource configuration dict

    Returns:
        Ray Serve deployment handle
    """
    memory_bytes = (
        _parse_memory(resources["memory"])
        if isinstance(resources["memory"], str)
        else resources["memory"]
    )

    ray_actor_options = {
        "num_cpus": resources["num_cpus"],
        "memory": memory_bytes,
    }
    if resources["num_gpus"] > 0:
        ray_actor_options["num_gpus"] = resources["num_gpus"]

    return create_agent_deployment(
        agent_class=agent_class,
        agent_name=agent_name,
        num_replicas=resources["num_replicas"],
        ray_actor_options=ray_actor_options,
        app_title=f"{agent_name} Agent",
    )


def _print_deployment_success(
    agent_name: str, endpoint_url: str, resources: dict[str, Any]
):
    """Print deployment success message.

    Args:
        agent_name: Name of deployed agent
        endpoint_url: Endpoint URL
        resources: Resource configuration
    """
    gpu_info = f", {resources['num_gpus']} GPUs" if resources["num_gpus"] > 0 else ""
    click.echo(
        f"Running '{agent_name}': {resources['num_replicas']} replicas, "
        f"{resources['num_cpus']} CPUs, {resources['memory']}{gpu_info}"
    )


def _print_deployment_summary(
    deployed_endpoints: list[tuple[str, str, dict]], port: int
):
    """Print summary of all deployed endpoints.

    Args:
        deployed_endpoints: List of (agent_name, endpoint_url, resources) tuples
        port: Server port
    """
    click.echo(f"\nSuccessfully deployed {len(deployed_endpoints)} endpoint(s):")
    for agent_name, endpoint_url, _resources in deployed_endpoints:
        click.echo(f"\n{agent_name}:")
        click.echo(f"  Endpoint: POST {endpoint_url}")
        click.echo(f"  Test it:  curl -X POST {endpoint_url} \\")
        click.echo("                 -H 'Content-Type: application/json' \\")
        json_data = '{"data": {"messages": [{"role": "user", "content": "hello"}]}, "session_id": "test"}'
        click.echo(f"                 -d '{json_data}'")

    click.echo("\nRay Dashboard: http://localhost:8265")
    click.echo("Press Ctrl+C to stop all agents")


def _validate_cli_resource_flags(
    cli_resources: dict[str, dict[str, Any]], discovered_agents: dict[str, Any]
) -> None:
    """
    Warn about CLI resource flags for agents that don't exist.

    Args:
        cli_resources: Parsed CLI resource flags
        discovered_agents: Dict of discovered agents
    """
    for agent_name in cli_resources.keys():
        if agent_name not in discovered_agents:
            flags = []
            for resource_key in cli_resources[agent_name].keys():
                flag_name = f"--{agent_name}-{resource_key.replace('_', '-')}"
                flags.append(flag_name)

            click.echo(
                f"Warning: Resource flags {', '.join(flags)} reference unknown agent '{agent_name}'"
            )
            click.echo(f"   Available agents: {', '.join(discovered_agents.keys())}")


def _deploy_agents(
    agents: dict[str, Any],
    port: int,
    cli_resources: dict[str, dict[str, Any]],
):
    """Deploy agents on Ray Serve with single /chat endpoint."""
    try:
        from ray import serve

        _initialize_ray_serve(port)
        _validate_cli_resource_flags(cli_resources, agents)
        deployed_endpoints = []

        for agent_name, agent_info in agents.items():
            agent_class = agent_info["class"]

            if not hasattr(agent_class, "run"):
                click.echo(
                    f"Warning: Agent '{agent_name}' has no run() method, skipping"
                )
                continue

            click.echo(f"Configuring agent '{agent_name}':")
            resources = _merge_all_resource_sources(
                agent_class, agent_name, cli_resources
            )

            deployment = _create_deployment(agent_name, agent_class, resources)
            serve.run(
                deployment,
                name=f"{agent_name}-service",
                route_prefix=f"/agents/{agent_name}",
            )

            endpoint_url = f"http://localhost:{port}/agents/{agent_name}/chat"
            deployed_endpoints.append((agent_name, endpoint_url, resources))
            _print_deployment_success(agent_name, endpoint_url, resources)

        if deployed_endpoints:
            _print_deployment_summary(deployed_endpoints, port)

            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                click.echo("\nShutting down agents...")
                serve.shutdown()
                import ray

                ray.shutdown()
                click.echo("All agents stopped")
        else:
            click.echo("No agents were deployed")
            serve.shutdown()
            import ray

            ray.shutdown()

    except Exception as e:
        click.echo(f"Failed to deploy agents: {e}")
        try:
            from ray import serve

            serve.shutdown()
            import ray

            ray.shutdown()
        except Exception:
            pass
