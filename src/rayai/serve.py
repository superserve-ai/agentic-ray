"""Agent serving utilities for Ray Serve.

The `serve()` function provides a simple way to serve agents via HTTP:
- When called in __main__ context: starts Ray Serve and blocks
- When imported by rayai up: registers agent, doesn't block

Example:
    # agents/myagent/agent.py
    import rayai
    from pydantic_ai import Agent

    @rayai.tool
    def search(query: str) -> str:
        '''Search the web.'''
        return f"Results for {query}"

    agent = Agent("gpt-4", tools=[search])

    # Serve with resources
    rayai.serve(agent, name="myagent", replicas=2, memory="4GB")

    # Run options:
    # python agents/myagent/agent.py  # Single agent (blocks)
    # rayai up                        # All agents in agents/
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

if TYPE_CHECKING:
    pass


# Global registry for rayai up to collect
_registered_agents: list[AgentConfig] = []

# Flag to indicate if we're being run by rayai up
_rayai_up_mode = False


@dataclass
class AgentConfig:
    """Configuration for a registered agent."""

    agent: Any
    name: str
    host: str
    port: int
    num_cpus: int | float
    num_gpus: int | float
    memory: str
    replicas: int
    route_prefix: str


class ChatRequest(BaseModel):
    """Request model for agent chat endpoint."""

    query: str
    session_id: str = "default"
    stream: bool = False


class ChatResponse(BaseModel):
    """Response model for agent chat endpoint."""

    response: str
    session_id: str


def serve(
    agent: Any,
    *,
    name: str | None = None,
    host: str = "0.0.0.0",
    port: int = 8000,
    num_cpus: int | float = 1,
    num_gpus: int | float = 0,
    memory: str = "2GB",
    replicas: int = 1,
    route_prefix: str | None = None,
) -> None:
    """Serve an agent via HTTP with Ray Serve.

    Behavior:
    - If called in __main__ context: starts Ray Serve and blocks
    - If imported by rayai up: registers agent, doesn't block

    Args:
        agent: Agent instance (Pydantic AI, LangChain, custom Agent, or callable).
        name: Name for the deployment. Inferred from caller if not provided.
        host: Host to bind to (default: "0.0.0.0").
        port: Port to serve on (default: 8000).
        num_cpus: CPU cores per replica (default: 1).
        num_gpus: GPUs per replica (default: 0).
        memory: Memory per replica (default: "2GB").
        replicas: Number of replicas (default: 1).
        route_prefix: URL prefix for this agent (default: /{name}).

    Example:
        # Single agent (blocks)
        python agents/myagent/agent.py

        # All agents (rayai up imports, then starts all)
        rayai up
    """
    # Infer name from caller if not provided
    if name is None:
        name = _infer_agent_name()

    # Default route prefix
    if route_prefix is None:
        route_prefix = f"/{name}"

    config = AgentConfig(
        agent=agent,
        name=name,
        host=host,
        port=port,
        num_cpus=num_cpus,
        num_gpus=num_gpus,
        memory=memory,
        replicas=replicas,
        route_prefix=route_prefix,
    )

    # Check if we're being run directly or imported
    if _is_main_context() and not _rayai_up_mode:
        # Block and serve immediately
        _start_serve([config], port=port, host=host)
    else:
        # Register for rayai up to collect
        _registered_agents.append(config)


def run(port: int = 8000, host: str = "0.0.0.0") -> None:
    """Start all registered agents. Called by rayai up.

    Args:
        port: Port to serve all agents on (default: 8000).
        host: Host to bind to (default: "0.0.0.0").
    """
    if _registered_agents:
        _start_serve(_registered_agents, port=port, host=host)


def get_registered_agents() -> list[AgentConfig]:
    """Get list of registered agent configs.

    Returns:
        List of AgentConfig objects.
    """
    return _registered_agents.copy()


def clear_registered_agents() -> None:
    """Clear the registered agents list. Useful for testing."""
    _registered_agents.clear()


def set_rayai_up_mode(enabled: bool) -> None:
    """Set whether we're running in rayai up mode.

    When True, serve() will register agents instead of blocking.

    Args:
        enabled: Whether rayai up mode is enabled.
    """
    global _rayai_up_mode
    _rayai_up_mode = enabled


def _is_main_context() -> bool:
    """Check if the caller is running as __main__.

    Returns True if serve() was called from a script run directly
    (not imported as a module).
    """
    # Get the caller's frame (2 levels up: _is_main_context -> serve -> caller)
    frame = sys._getframe(2)
    caller_globals = frame.f_globals

    # Check if the caller's module is __main__
    return caller_globals.get("__name__") == "__main__"


def _infer_agent_name() -> str:
    """Infer agent name from caller's file path.

    Returns the parent directory name of the calling file,
    e.g., "myagent" for agents/myagent/agent.py.
    """
    import os

    # Get caller's frame (3 levels up: _infer_agent_name -> serve -> caller)
    frame = sys._getframe(2)
    caller_file = frame.f_globals.get("__file__", "unknown")

    # Get parent directory name
    parent_dir = os.path.basename(os.path.dirname(os.path.abspath(caller_file)))

    if parent_dir and parent_dir != ".":
        return str(parent_dir)

    # Fall back to filename without extension
    return str(os.path.splitext(os.path.basename(caller_file))[0])


def _start_serve(
    configs: list[AgentConfig],
    port: int = 8000,
    host: str = "0.0.0.0",
) -> None:
    """Start Ray Serve with the given agent configurations.

    Args:
        configs: List of agent configurations.
        port: Port to serve on.
        host: Host to bind to.
    """
    import ray
    from ray import serve as ray_serve

    from rayai.resource_loader import _parse_memory

    # Initialize Ray if needed
    if not ray.is_initialized():
        ray.init()

    # Create deployments for each agent
    deployments = []

    for config in configs:
        deployment = _create_agent_deployment(
            agent=config.agent,
            name=config.name,
            replicas=config.replicas,
            ray_actor_options={
                "num_cpus": config.num_cpus,
                "num_gpus": config.num_gpus,
                "memory": _parse_memory(config.memory),
            },
            route_prefix=config.route_prefix,
        )
        deployments.append(deployment)

    # Start Ray Serve
    ray_serve.start(http_options={"host": host, "port": port})

    # Deploy all agents
    for deployment in deployments:
        ray_serve.run(deployment, _blocking=False)

    print(f"\n🚀 RayAI serving {len(configs)} agent(s) at http://{host}:{port}")
    for config in configs:
        print(f"   • {config.name}: {config.route_prefix}")
    print("\nPress Ctrl+C to stop.\n")

    # Block forever
    try:
        import signal

        signal.pause()
    except (KeyboardInterrupt, AttributeError):
        # AttributeError on Windows where signal.pause() doesn't exist
        try:
            while True:
                import time

                time.sleep(1)
        except KeyboardInterrupt:
            pass

    print("\nShutting down...")
    ray_serve.shutdown()


def _create_agent_deployment(
    agent: Any,
    name: str,
    replicas: int,
    ray_actor_options: dict[str, Any],
    route_prefix: str,
):
    """Create a Ray Serve deployment for an agent.

    Auto-detects framework type and creates appropriate handlers.

    Args:
        agent: Agent instance.
        name: Deployment name.
        replicas: Number of replicas.
        ray_actor_options: Ray actor options.
        route_prefix: URL prefix.

    Returns:
        Ray Serve deployment.
    """
    from ray import serve as ray_serve

    app = FastAPI(title=f"{name} Agent")

    # Detect agent type and create appropriate runner
    runner = _create_agent_runner(agent)

    @ray_serve.deployment(
        name=f"{name}-deployment",
        num_replicas=replicas,
        ray_actor_options=ray_actor_options,
        route_prefix=route_prefix,
    )
    @ray_serve.ingress(app)
    class AgentDeployment:
        def __init__(self):
            self.runner = runner
            self.agent = agent

        @app.post("/")
        async def chat(self, request: ChatRequest) -> ChatResponse | StreamingResponse:
            try:
                if request.stream:
                    # Check for streaming support
                    if hasattr(self.runner, "run_stream"):
                        return StreamingResponse(
                            _stream_generator(self.runner.run_stream(request.query)),
                            media_type="text/event-stream",
                            headers={
                                "Cache-Control": "no-cache",
                                "Connection": "keep-alive",
                            },
                        )
                    raise HTTPException(
                        status_code=400,
                        detail="Agent does not support streaming",
                    )

                # Non-streaming
                result = await self.runner.run(request.query)
                return ChatResponse(
                    response=str(result),
                    session_id=request.session_id,
                )
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e)) from e

        @app.get("/health")
        async def health(self):
            return {"status": "healthy", "agent": name}

    return AgentDeployment.bind()  # type: ignore[attr-defined]


class _AgentRunner:
    """Wrapper for running agents of different types."""

    def __init__(self, agent: Any):
        self.agent = agent
        self.agent_type = self._detect_type(agent)

    def _detect_type(self, agent: Any) -> str:
        """Detect the type of agent."""
        # Pydantic AI Agent
        if _is_pydantic_ai_agent(agent):
            return "pydantic_ai"

        # LangChain/LangGraph agent
        if _is_langchain_agent(agent):
            return "langchain"

        # Custom rayai.Agent
        if _is_rayai_agent(agent):
            return "rayai"

        # Callable
        if callable(agent):
            return "callable"

        raise TypeError(f"Unknown agent type: {type(agent)}")

    async def run(self, query: str) -> str:
        """Run the agent with a query."""
        if self.agent_type == "pydantic_ai":
            return await self._run_pydantic_ai(query)
        elif self.agent_type == "langchain":
            return await self._run_langchain(query)
        elif self.agent_type == "rayai":
            return await self._run_rayai(query)
        elif self.agent_type == "callable":
            return await self._run_callable(query)
        else:
            raise ValueError(f"Unknown agent type: {self.agent_type}")

    async def _run_pydantic_ai(self, query: str) -> str:
        """Run a Pydantic AI agent."""
        result = await self.agent.run(query)
        return str(result.data)

    async def _run_langchain(self, query: str) -> str:
        """Run a LangChain agent."""
        # LangChain agents can be invoked with invoke() or ainvoke()
        if hasattr(self.agent, "ainvoke"):
            result = await self.agent.ainvoke({"input": query})
        elif hasattr(self.agent, "invoke"):
            result = self.agent.invoke({"input": query})
        else:
            result = self.agent(query)

        # Extract output
        if isinstance(result, dict):
            output = result.get("output", str(result))
            return str(output)
        return str(result)

    async def _run_rayai(self, query: str) -> str:
        """Run a rayai.Agent."""
        result = await self.agent.run(query)
        return str(result)

    async def _run_callable(self, query: str) -> str:
        """Run a callable agent."""
        result = self.agent(query)
        if inspect.iscoroutine(result):
            result = await result
        return str(result)


def _create_agent_runner(agent: Any) -> _AgentRunner:
    """Create a runner for the given agent."""
    return _AgentRunner(agent)


def _is_pydantic_ai_agent(obj: Any) -> bool:
    """Check if obj is a Pydantic AI Agent."""
    try:
        from pydantic_ai import Agent

        return isinstance(obj, Agent)
    except ImportError:
        return False


def _is_langchain_agent(obj: Any) -> bool:
    """Check if obj is a LangChain agent."""
    # Check for common LangChain agent types
    try:
        from langchain.agents import AgentExecutor  # type: ignore[attr-defined]

        if isinstance(obj, AgentExecutor):
            return True
    except ImportError:
        pass

    try:
        from langgraph.graph import CompiledGraph  # type: ignore[attr-defined]

        if isinstance(obj, CompiledGraph):
            return True
    except ImportError:
        pass

    # Check for Runnable interface
    try:
        from langchain_core.runnables import Runnable

        if isinstance(obj, Runnable):
            return True
    except ImportError:
        pass

    return False


def _is_rayai_agent(obj: Any) -> bool:
    """Check if obj is a rayai.Agent."""
    try:
        from rayai.agent_base import Agent

        return isinstance(obj, Agent)
    except ImportError:
        return False


async def _stream_generator(async_gen):
    """Wrap async generator in SSE format."""
    try:
        async for chunk in async_gen:
            if chunk:
                yield f"data: {json.dumps({'content': str(chunk)})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    except asyncio.CancelledError:
        raise
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
