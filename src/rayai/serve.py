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
from typing import TYPE_CHECKING, Any, Literal

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
    stream: Literal[False, "text", "events"] = False


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
        )
        deployments.append((deployment, config.route_prefix))

    # Start Ray Serve
    ray_serve.start(http_options={"host": host, "port": port})

    for (deployment, route_prefix), config in zip(deployments, configs, strict=False):
        ray_serve.run(deployment, route_prefix=route_prefix, name=config.name)

    print(f"\n RayAI serving {len(configs)} agent(s) at http://{host}:{port}")
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
):
    """Create a Ray Serve deployment for an agent.

    Auto-detects framework type and creates appropriate handlers.

    Args:
        agent: Agent instance.
        name: Deployment name.
        replicas: Number of replicas.
        ray_actor_options: Ray actor options.

    Returns:
        Ray Serve deployment.
    """
    from ray import serve as ray_serve

    app = FastAPI(title=f"{name} Agent", redirect_slashes=False)

    @ray_serve.deployment(
        name=f"{name}-deployment",
        num_replicas=replicas,
        ray_actor_options=ray_actor_options,
    )
    @ray_serve.ingress(app)
    class AgentDeployment:
        def __init__(self, agent_or_factory: Any):
            if callable(agent_or_factory) and not _is_agent_instance(agent_or_factory):
                self.agent = agent_or_factory()
            else:
                self.agent = agent_or_factory
            self.runner = _create_agent_runner(self.agent)

        @app.post("/", response_model=None)
        async def chat(self, request: ChatRequest) -> ChatResponse | StreamingResponse:
            try:
                if request.stream == "text":
                    # Text streaming
                    if not self.runner.supports_streaming():
                        raise HTTPException(
                            status_code=400,
                            detail="Agent does not support text streaming",
                        )
                    return StreamingResponse(
                        _stream_text_generator(self.runner.run_stream(request.query)),
                        media_type="text/event-stream",
                        headers={
                            "Cache-Control": "no-cache",
                            "Connection": "keep-alive",
                        },
                    )

                if request.stream == "events":
                    # Event streaming
                    if not self.runner.supports_event_streaming():
                        raise HTTPException(
                            status_code=400,
                            detail="Agent does not support event streaming",
                        )
                    return StreamingResponse(
                        _stream_events_generator(
                            self.runner.run_stream_events(request.query)
                        ),
                        media_type="text/event-stream",
                        headers={
                            "Cache-Control": "no-cache",
                            "Connection": "keep-alive",
                        },
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

    return AgentDeployment.bind(agent)  # type: ignore[attr-defined]


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

    def supports_streaming(self) -> bool:
        """Check if the agent supports text streaming."""
        if self.agent_type == "pydantic_ai":
            return hasattr(self.agent, "run_stream")
        elif self.agent_type == "langchain":
            return hasattr(self.agent, "astream") or hasattr(self.agent, "stream")
        elif self.agent_type == "rayai":
            return hasattr(self.agent, "run_stream")
        return False

    def supports_event_streaming(self) -> bool:
        """Check if the agent supports event streaming."""
        if self.agent_type == "pydantic_ai":
            return hasattr(self.agent, "run_stream_events")
        elif self.agent_type == "langchain":
            return hasattr(self.agent, "astream_events")
        elif self.agent_type == "rayai":
            return hasattr(self.agent, "run_stream_events")
        return False

    async def run_stream(self, query: str):
        """Stream text chunks from the agent."""
        if self.agent_type == "pydantic_ai":
            async for chunk in self._stream_pydantic_ai(query):
                yield chunk
        elif self.agent_type == "langchain":
            async for chunk in self._stream_langchain(query):
                yield chunk
        elif self.agent_type == "rayai":
            async for chunk in self._stream_rayai(query):
                yield chunk
        else:
            raise ValueError(f"Text streaming not supported for: {self.agent_type}")

    async def run_stream_events(self, query: str):
        """Stream structured events from the agent."""
        if self.agent_type == "pydantic_ai":
            async for event in self._stream_events_pydantic_ai(query):
                yield event
        elif self.agent_type == "langchain":
            async for event in self._stream_events_langchain(query):
                yield event
        elif self.agent_type == "rayai":
            async for event in self._stream_events_rayai(query):
                yield event
        else:
            raise ValueError(f"Event streaming not supported for: {self.agent_type}")

    async def _stream_pydantic_ai(self, query: str):
        """Stream from a Pydantic AI agent."""
        async with self.agent.run_stream(query) as result:
            async for text in result.stream_text(delta=True):
                yield text

    async def _stream_langchain(self, query: str):
        """Stream text tokens from a LangChain agent."""
        from langchain_core.messages import HumanMessage

        input_data = {"messages": [HumanMessage(content=query)]}

        if hasattr(self.agent, "astream"):
            async for chunk in self.agent.astream(input_data, stream_mode="messages"):
                if isinstance(chunk, tuple) and len(chunk) >= 1:
                    token = chunk[0]
                    if hasattr(token, "content") and token.content:
                        yield token.content
                elif hasattr(chunk, "content") and chunk.content:
                    yield chunk.content

    async def _stream_rayai(self, query: str):
        """Stream from a rayai.Agent."""
        async for chunk in self.agent.run_stream(query):
            yield chunk

    async def _stream_events_pydantic_ai(self, query: str):
        """Stream events from a Pydantic AI agent using run_stream_events()."""
        async for event in self.agent.run_stream_events(query):
            event_name = type(event).__name__

            if event_name == "FunctionToolCallEvent":
                part = event.part
                args = getattr(part, "args", {})
                if isinstance(args, bytes):
                    try:
                        args = json.loads(args.decode())
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        args = {}
                elif isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except json.JSONDecodeError:
                        args = {"input": args}
                yield {
                    "type": "tool_call",
                    "tool": getattr(part, "tool_name", "unknown"),
                    "input": args,
                }

            elif event_name == "FunctionToolResultEvent":
                # Tool returned a result
                result = getattr(event, "result", None)
                tool_name = (
                    getattr(result, "tool_name", "unknown") if result else "unknown"
                )
                content = getattr(result, "content", "") if result else str(event)
                yield {
                    "type": "tool_result",
                    "tool": tool_name,
                    "output": str(content),
                }

            elif event_name == "PartDeltaEvent":
                delta = getattr(event, "delta", None)
                if delta:
                    delta_type = type(delta).__name__
                    if delta_type == "TextPartDelta":
                        content = getattr(delta, "content_delta", "")
                        if content:
                            yield {"type": "text", "content": content}

    async def _stream_events_langchain(self, query: str):
        """Stream events from a LangChain agent."""
        from langchain_core.messages import HumanMessage

        input_data = {"messages": [HumanMessage(content=query)]}

        async for event in self.agent.astream_events(input_data, version="v2"):
            event_type = event.get("event", "")
            if event_type == "on_tool_start":
                yield {
                    "type": "tool_call",
                    "tool": event.get("name", "unknown"),
                    "input": event.get("data", {}).get("input", {}),
                }
            elif event_type == "on_tool_end":
                output = event.get("data", {}).get("output", "")
                if hasattr(output, "content"):
                    output = output.content
                yield {
                    "type": "tool_result",
                    "tool": event.get("name", "unknown"),
                    "output": str(output),
                }
            elif event_type == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content") and chunk.content:
                    yield {"type": "text", "content": chunk.content}

    async def _stream_events_rayai(self, query: str):
        """Stream events from a rayai.Agent."""
        async for event in self.agent.run_stream_events(query):
            yield event

    async def _run_pydantic_ai(self, query: str) -> str:
        """Run a Pydantic AI agent."""
        result = await self.agent.run(query)
        return str(result.output)

    async def _run_langchain(self, query: str) -> str:
        """Run a LangChain agent."""
        from langchain_core.messages import HumanMessage

        input_data = {"messages": [HumanMessage(content=query)]}

        if hasattr(self.agent, "ainvoke"):
            result = await self.agent.ainvoke(input_data)
        elif hasattr(self.agent, "invoke"):
            result = self.agent.invoke(input_data)
        else:
            result = self.agent(query)

        if isinstance(result, dict) and "messages" in result:
            messages = result["messages"]
            if messages:
                last_message = messages[-1]
                if hasattr(last_message, "content"):
                    return str(last_message.content)
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


def _is_agent_instance(obj: Any) -> bool:
    """Check if obj is an agent instance (not a factory function).

    Returns True if obj is a known agent type (Pydantic AI, LangChain, rayai.Agent).
    Returns False if obj appears to be a factory function.
    """
    return (
        _is_pydantic_ai_agent(obj) or _is_langchain_agent(obj) or _is_rayai_agent(obj)
    )


async def _stream_text_generator(async_gen):
    """Wrap async generator in SSE format for text streaming."""
    try:
        async for chunk in async_gen:
            if chunk:
                yield f"data: {chunk}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    except asyncio.CancelledError:
        raise
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"


async def _stream_events_generator(async_gen):
    """Wrap async generator in SSE format for event streaming."""
    try:
        async for event in async_gen:
            if event:
                yield f"data: {json.dumps(event)}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    except asyncio.CancelledError:
        raise
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
