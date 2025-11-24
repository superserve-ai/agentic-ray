"""Serve projects locally with Ray Serve."""

import importlib.util
import inspect
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import click


@click.command()
@click.argument("project_path", default=".")
@click.option("--port", default=8000, help="Port to serve on")
@click.option("--agents", help="Deploy specific agents (comma-separated)")
def serve(project_path: str, port: int, agents: str):
    """Serve agents using Ray Serve."""
    project_dir = Path(project_path).resolve()

    if not project_dir.exists():
        click.echo(f"Error: Project directory not found: {project_dir}")
        return

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

    _deploy_agents(agents_to_deploy, port)


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
    """Load Agent class from a Python file."""
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

        for _name, obj in inspect.getmembers(module, inspect.isclass):
            if obj.__module__ == module.__name__ and hasattr(obj, "run"):
                return obj

        if hasattr(module, "Agent"):
            return module.Agent

        click.echo(f"No agent class found in {file_path}")
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


def _create_chat_endpoint(app, agent_class: Any):
    """Create a single /chat endpoint for the agent."""
    from typing import Any

    from fastapi import HTTPException
    from pydantic import BaseModel

    class ChatRequest(BaseModel):
        data: dict[Any, Any]
        session_id: str = "default"

    class ChatResponse(BaseModel):
        result: dict[Any, Any]
        session_id: str

    @app.post("/chat", response_model=ChatResponse)
    async def chat_endpoint(request: ChatRequest):
        try:
            agent = agent_class()
            result = agent.run(request.data)
            return ChatResponse(result=result, session_id=request.session_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e


def _deploy_agents(agents: dict[str, Any], port: int):
    """Deploy agents on Ray Serve with single /chat endpoint."""
    try:
        import ray
        from fastapi import FastAPI
        from ray import serve

        click.echo("Initializing Ray...")

        if not ray.is_initialized():
            ray.init(ignore_reinit_error=True)

        serve.start(detached=True, http_options={"host": "0.0.0.0", "port": port})
        deployed_endpoints = []

        for agent_name, agent_info in agents.items():
            agent_class = agent_info["class"]

            if not hasattr(agent_class, "run"):
                click.echo(
                    f"Warning: Agent '{agent_name}' has no run() method, skipping"
                )
                continue

            app = FastAPI(title=f"{agent_name} Agent")
            _create_chat_endpoint(app, agent_class)

            @serve.deployment(name=f"{agent_name}-deployment", num_replicas=1)
            @serve.ingress(app)
            class AgentDeployment:
                def __init__(self, agent_cls=agent_class):
                    self.agent = agent_cls()

            deployment = AgentDeployment.bind()  # type: ignore
            serve.run(
                deployment,
                name=f"{agent_name}-service",
                route_prefix=f"/agents/{agent_name}",
            )

            endpoint_url = f"http://localhost:{port}/agents/{agent_name}/chat"
            deployed_endpoints.append((agent_name, endpoint_url))
            click.echo(f"Deployed agent '{agent_name}' at /chat endpoint")

        if deployed_endpoints:
            click.echo(
                f"\nSuccessfully deployed {len(deployed_endpoints)} endpoint(s):"
            )
            for agent_name, endpoint_url in deployed_endpoints:
                click.echo(f"\n{agent_name}:")
                click.echo(f"  Endpoint: POST {endpoint_url}")
                click.echo(f"  Test it:  curl -X POST {endpoint_url} \\")
                click.echo("                 -H 'Content-Type: application/json' \\")
                json_data = '{"data": {"message": "hello"}, "session_id": "test"}'
                click.echo(f"                 -d '{json_data}'")

            click.echo("\nRay Dashboard: http://localhost:8265")
            click.echo("Press Ctrl+C to stop all agents")

            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                click.echo("\nShutting down agents...")
                serve.shutdown()
                ray.shutdown()
                click.echo("All agents stopped")
        else:
            click.echo("No agents were deployed")
            serve.shutdown()
            ray.shutdown()

    except Exception as e:
        click.echo(f"Failed to deploy agents: {e}")
        try:
            serve.shutdown()
            ray.shutdown()
        except Exception:
            pass
