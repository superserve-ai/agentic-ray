"""Agent deployment utilities for Ray Serve."""

import asyncio
import inspect
import json
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ray import serve


class ChatRequest(BaseModel):
    """Request model for agent chat endpoint."""

    data: dict[Any, Any]
    session_id: str = "default"
    stream: Literal[False, "text", "events"] = False


class ChatResponse(BaseModel):
    """Response model for agent chat endpoint."""

    result: dict[Any, Any]
    session_id: str


async def _stream_text_generator(async_gen):
    """Wrap async generator in SSE format for text streaming.

    Args:
        async_gen: Async generator yielding text chunks

    Yields:
        SSE formatted strings (data: chunk\\n\\n)
    """
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
    """Wrap async generator in SSE format for event streaming.

    Args:
        async_gen: Async generator yielding event dicts

    Yields:
        SSE formatted JSON strings (data: {...}\\n\\n)
    """
    try:
        async for event in async_gen:
            if event:
                yield f"data: {json.dumps(event)}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    except asyncio.CancelledError:
        raise
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"


def create_agent_deployment(
    agent_class: Any,
    agent_name: str,
    num_replicas: int,
    ray_actor_options: dict[str, Any],
    app_title: str | None = None,
):
    """Create a Ray Serve deployment for an agent.

    Args:
        agent_class: The RayAgent class to deploy
        agent_name: Name for the deployment
        num_replicas: Number of replicas to deploy
        ray_actor_options: Ray actor options (num_cpus, memory, num_gpus)
        app_title: Optional title for the FastAPI app

    Returns:
        Ray Serve deployment handle
    """
    app = FastAPI(title=app_title or f"{agent_name} Agent")

    @serve.deployment(
        name=f"{agent_name}-deployment",
        num_replicas=num_replicas,
        ray_actor_options=ray_actor_options,
    )
    @serve.ingress(app)
    class AgentDeployment:
        def __init__(self, agent_cls=agent_class):
            self.agent = agent_cls()

        @app.post("/chat")
        async def chat_endpoint(self, request: ChatRequest):
            try:
                if request.stream == "text":
                    if not hasattr(self.agent, "run_stream"):
                        raise HTTPException(
                            status_code=400,
                            detail="Agent does not support text streaming. Implement run_stream() method.",
                        )
                    return StreamingResponse(
                        _stream_text_generator(self.agent.run_stream(request.data)),
                        media_type="text/event-stream",
                        headers={
                            "Cache-Control": "no-cache",
                            "Connection": "keep-alive",
                        },
                    )

                if request.stream == "events":
                    if not hasattr(self.agent, "run_stream_events"):
                        raise HTTPException(
                            status_code=400,
                            detail="Agent does not support event streaming. Implement run_stream_events() method.",
                        )
                    return StreamingResponse(
                        _stream_events_generator(
                            self.agent.run_stream_events(request.data)
                        ),
                        media_type="text/event-stream",
                        headers={
                            "Cache-Control": "no-cache",
                            "Connection": "keep-alive",
                        },
                    )

                result = self.agent.run(request.data)

                if inspect.iscoroutine(result):
                    result = await result

                return ChatResponse(result=result, session_id=request.session_id)
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e)) from e

    return AgentDeployment.bind()  # type: ignore[attr-defined]
