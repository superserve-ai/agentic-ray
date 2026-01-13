"""Agent packaging for cloud deployment."""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import zipfile
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import TYPE_CHECKING

from .types import AgentManifest, DeploymentManifest

if TYPE_CHECKING:
    from rayai.serve import AgentConfig


def package_deployment(
    project_path: Path,
    agents: list[AgentConfig],
    deployment_name: str,
) -> tuple[Path, DeploymentManifest]:
    """Package agents for cloud deployment.

    Creates a zip archive containing:
    - agents/ directory with agent code
    - manifest.json with deployment metadata
    - pyproject.toml (if exists)

    Args:
        project_path: Path to project root.
        agents: List of discovered agent configs.
        deployment_name: Name for the deployment.

    Returns:
        Tuple of (package_path, manifest).
    """
    # Parse user dependencies to include in manifest
    user_deps = _parse_user_dependencies(project_path)

    manifest = DeploymentManifest(
        name=deployment_name,
        rayai_version=version("rayai"),
        python_version=f"{sys.version_info.major}.{sys.version_info.minor}",
        created_at=datetime.now(UTC).isoformat(),
        agents=[
            AgentManifest(
                name=config.name,
                route_prefix=config.route_prefix,
                num_cpus=config.num_cpus,
                num_gpus=config.num_gpus,
                memory=config.memory,
                replicas=config.replicas,
                pip=user_deps,
            )
            for config in agents
        ],
    )

    fd, package_path_str = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    package_path = Path(package_path_str)

    with zipfile.ZipFile(package_path, "w", zipfile.ZIP_DEFLATED) as zf:
        agents_dir = project_path / "agents"
        if agents_dir.exists():
            for agent_folder in agents_dir.iterdir():
                if agent_folder.is_dir() and not agent_folder.name.startswith("__"):
                    _add_directory_to_zip(
                        zf, agent_folder, f"agents/{agent_folder.name}"
                    )

        # Generate serve entry points for each agent
        for config in agents:
            entry_point = _generate_serve_entry_point(config.name)
            zf.writestr(f"serve_{config.name}.py", entry_point)

        pyproject_file = project_path / "pyproject.toml"
        if pyproject_file.exists():
            zf.write(pyproject_file, arcname="pyproject.toml")

        # Include any .whl files in the project root (for local package testing)
        for whl_file in project_path.glob("*.whl"):
            zf.write(whl_file, arcname=whl_file.name)

        manifest_json = manifest.model_dump_json(indent=2)
        zf.writestr("manifest.json", manifest_json)

    manifest.checksum = _calculate_checksum(package_path)

    return package_path, manifest


def _parse_user_dependencies(project_path: Path) -> list[str]:
    """Parse user dependencies from pyproject.toml.

    Args:
        project_path: Path to project root.

    Returns:
        List of dependency strings (excluding rayai from PyPI, but including local wheels).
    """
    import tomllib

    deps: list[str] = []
    pyproject_file = project_path / "pyproject.toml"
    if pyproject_file.exists():
        with open(pyproject_file, "rb") as f:
            data = tomllib.load(f)
        dependencies = data.get("project", {}).get("dependencies", [])
        for dep in dependencies:
            dep_lower = dep.lower()
            # Skip rayai from PyPI (handled by platform), but include local wheel references
            if dep_lower.startswith("rayai"):
                # Include if it's a local wheel reference (contains @ or path)
                if "@" in dep or ".whl" in dep:
                    deps.append(dep)
                # Otherwise skip (platform will install from PyPI)
            else:
                deps.append(dep)
    return deps


def _generate_serve_entry_point(agent_name: str) -> str:
    """Generate a Ray Serve entry point script for an agent.

    Creates a self-contained module for cloud deployment.
    """
    return f'''"""Ray Serve entry point for {agent_name}."""
import sys
import os
import inspect

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from ray import serve

class ChatRequest(BaseModel):
    query: str
    session_id: str = "default"

class ChatResponse(BaseModel):
    response: str
    session_id: str

from agents.{agent_name}.agent import make_agent

fastapi_app = FastAPI(title="{agent_name}")


def _is_pydantic_ai_agent(obj):
    """Check if obj is a Pydantic AI Agent."""
    try:
        from pydantic_ai import Agent
        return isinstance(obj, Agent)
    except ImportError:
        return False


def _is_langchain_agent(obj):
    """Check if obj is a LangChain agent."""
    try:
        from langchain.agents import AgentExecutor
        if isinstance(obj, AgentExecutor):
            return True
    except ImportError:
        pass
    try:
        from langgraph.graph.state import CompiledGraph
        if isinstance(obj, CompiledGraph):
            return True
    except ImportError:
        pass
    try:
        from langchain_core.runnables import Runnable
        if isinstance(obj, Runnable):
            return True
    except ImportError:
        pass
    return False


@serve.deployment(name="{agent_name}")
@serve.ingress(fastapi_app)
class AgentDeployment:
    def __init__(self):
        self.agent = make_agent()
        self.agent_type = self._detect_type()

    def _detect_type(self):
        if _is_pydantic_ai_agent(self.agent):
            return "pydantic_ai"
        if _is_langchain_agent(self.agent):
            return "langchain"
        if callable(self.agent):
            return "callable"
        return "unknown"

    @fastapi_app.post("/")
    async def chat(self, request: ChatRequest) -> ChatResponse:
        try:
            if self.agent_type == "pydantic_ai":
                result = await self.agent.run(request.query)
                response = str(result.output)

            elif self.agent_type == "langchain":
                from langchain_core.messages import HumanMessage
                input_data = {{"messages": [HumanMessage(content=request.query)]}}
                if hasattr(self.agent, "ainvoke"):
                    result = await self.agent.ainvoke(input_data)
                elif hasattr(self.agent, "invoke"):
                    result = self.agent.invoke(input_data)
                else:
                    result = self.agent(request.query)
                if isinstance(result, dict) and "messages" in result:
                    messages = result["messages"]
                    if messages and hasattr(messages[-1], "content"):
                        response = str(messages[-1].content)
                    else:
                        response = str(result)
                else:
                    response = str(result)

            elif self.agent_type == "callable":
                result = self.agent(request.query)
                if inspect.iscoroutine(result):
                    result = await result
                response = str(result)

            else:
                response = str(self.agent)

            return ChatResponse(response=response, session_id=request.session_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @fastapi_app.get("/health")
    async def health(self):
        return {{"status": "healthy", "agent": "{agent_name}"}}

app = AgentDeployment.bind()
'''


def _add_directory_to_zip(zf: zipfile.ZipFile, source_path: Path, arcname: str) -> None:
    """Add directory to zip archive, excluding __pycache__ and .pyc files.

    Args:
        zf: Open zipfile.
        source_path: Source directory path.
        arcname: Archive name for the directory.
    """
    for item in source_path.rglob("*"):
        if "__pycache__" in item.parts or item.suffix == ".pyc":
            continue

        rel_path = item.relative_to(source_path)
        zip_path = f"{arcname}/{rel_path}"

        if item.is_file():
            zf.write(item, arcname=zip_path)


def _calculate_checksum(path: Path) -> str:
    """Calculate SHA256 checksum of a file.

    Args:
        path: Path to file.

    Returns:
        Hex-encoded SHA256 checksum.
    """
    sha256 = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()
