"""Agent deployment utilities for Ray Serve."""

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from ray import serve


class ChatRequest(BaseModel):
    """Request model for agent chat endpoint."""

    data: dict[Any, Any]
    session_id: str = "default"


class ChatResponse(BaseModel):
    """Response model for agent chat endpoint."""

    result: dict[Any, Any]
    session_id: str


def create_agent_app(agent_class: Any) -> FastAPI:
    """Create a FastAPI app with a /chat endpoint for the agent.

    Args:
        agent_class: The RayAgent class to deploy

    Returns:
        FastAPI app with /chat endpoint configured
    """
    app = FastAPI()

    @app.post("/chat", response_model=ChatResponse)
    async def chat_endpoint(request: ChatRequest):
        try:
            agent = agent_class()
            result = agent.run(request.data)
            return ChatResponse(result=result, session_id=request.session_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    return app


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
    app = create_agent_app(agent_class)
    if app_title:
        app.title = app_title

    @serve.deployment(
        name=f"{agent_name}-deployment",
        num_replicas=num_replicas,
        ray_actor_options=ray_actor_options,
    )
    @serve.ingress(app)
    class AgentDeployment:
        def __init__(self, agent_cls=agent_class):
            self.agent = agent_cls()

    return AgentDeployment.bind()  # type: ignore[attr-defined]
