"""Pydantic AI agent adapter for Ray distributed tool execution."""

import functools
import logging
from typing import Any

import ray

from ray_agents.adapters.abc import AgentAdapter

logger = logging.getLogger(__name__)


class PydanticAIAdapter(AgentAdapter):
    """
    Adapter for Pydantic AI agents with Ray distributed tool execution.

    This adapter wraps Pydantic AI's agent execution while executing tools as
    Ray tasks. Pydantic AI maintains full control over the agent flow; Ray
    provides distributed execution.

    When Pydantic AI calls a tool, it's actually executing:
        result = ray.get(tool.remote(**args))

    This means tools automatically run on cluster nodes with appropriate resources.

    Example:
        >>> from pydantic_ai import Agent
        >>> from ray_agents.adapters.pydantic import PydanticAIAdapter
        >>> from ray_agents import AgentSession
        >>> import ray
        >>>
        >>> # Define tools with resource requirements
        >>> @ray.remote(num_gpus=1)
        >>> def tool_a(param: str):
        ...     '''First tool with specific resource needs'''
        ...     return {"output": "result_a"}
        >>>
        >>> @ray.remote(num_cpus=8, memory=4 * 1024**3)
        >>> def tool_b(param: dict):
        ...     '''Second tool with different resource needs'''
        ...     return {"output": "result_b"}
        >>>
        >>> # Create Pydantic AI agent
        >>> pydantic_agent = Agent('openai:gpt-4o-mini')
        >>>
        >>> # Create adapter
        >>> adapter = PydanticAIAdapter(agent=pydantic_agent)
        >>>
        >>> # Use with AgentSession for stateful conversations
        >>> session = AgentSession.remote("user_id", adapter=adapter)
        >>> result = ray.get(session.run.remote(
        ...     "Use the available tools to help me",
        ...     tools=[tool_a, tool_b]
        ... ))
    """

    def __init__(
        self,
        agent: Any,
    ):
        """
        Initialize Pydantic AI agent adapter.

        Args:
            agent: Pre-configured Pydantic AI Agent instance
                   User has full control over model, dependencies, output type, etc.

        Example:
            >>> from pydantic_ai import Agent
            >>> agent = Agent('openai:gpt-4o-mini')
            >>> adapter = PydanticAIAdapter(agent=agent)
        """
        self.agent = agent

    async def run(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> dict[str, Any]:
        """
        Execute Pydantic AI agent with Ray distributed tools.

        Flow:
        1. Wrap Ray remote functions → Pydantic AI compatible callables
        2. Register tools with Pydantic AI agent
        3. Agent executes its loop (decides which tools to call)
        4. When tool is called, Ray executes it distributed
        5. Pydantic AI generates final response

        Args:
            message: Current user message
            messages: Conversation history
            tools: List of Ray remote functions

        Returns:
            Response dict with 'content' key and metadata
        """
        try:
            wrapped_tools = self._wrap_ray_tools_for_pydantic(tools)

            response_text = await self._execute_agent(message, messages, wrapped_tools)

            return {
                "content": response_text,
                "tools_available": len(tools),
            }

        except Exception as e:
            logger.error(f"Error in Pydantic AI adapter: {e}")
            raise

    def _wrap_ray_tools_for_pydantic(self, ray_tools: list[Any]) -> list[Any]:
        """
        Wrap Ray remote functions as Pydantic AI-compatible callables.

        This is the key integration point: when Pydantic AI calls these tools,
        they execute as Ray tasks (distributed across cluster).

        Args:
            ray_tools: List of Ray remote functions

        Returns:
            List of callables that Pydantic AI can use as tools
        """
        wrapped_tools = []

        for ray_tool in ray_tools:
            if hasattr(ray_tool, "remote"):
                remote_func = ray_tool
            elif hasattr(ray_tool, "_remote_func"):
                remote_func = ray_tool._remote_func
            else:
                logger.warning(
                    f"Tool {ray_tool} is not a Ray remote function, skipping"
                )
                continue

            def make_wrapper(tool, original_tool):
                """Create wrapper that preserves signature for Pydantic AI."""
                if hasattr(tool, "_function"):
                    original_func = tool._function
                elif hasattr(original_tool, "__name__"):
                    original_func = original_tool
                else:
                    original_func = tool

                @functools.wraps(original_func)
                def sync_wrapper(*args, **kwargs):
                    object_ref = tool.remote(*args, **kwargs)
                    result = ray.get(object_ref)
                    return result

                return sync_wrapper

            wrapped_tools.append(make_wrapper(remote_func, ray_tool))

        return wrapped_tools

    async def _execute_agent(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> str:
        """
        Execute Pydantic AI agent with tool calling.

        Args:
            message: User message
            messages: Conversation history
            tools: Wrapped tools (execute via Ray when called)

        Returns:
            Response text from agent
        """
        try:
            try:
                from pydantic_ai import FunctionToolset
                from pydantic_ai.messages import (
                    ModelMessage,
                    ModelRequest,
                    ModelResponse,
                    UserPromptPart,
                )
            except ImportError as e:
                raise ImportError(
                    "Pydantic AI adapter requires 'pydantic-ai'. "
                    "Install with: pip install pydantic-ai"
                ) from e

            message_history: list[ModelMessage] = []
            for msg in messages[:-1]:
                if msg["role"] == "user":
                    message_history.append(
                        ModelRequest(parts=[UserPromptPart(content=msg["content"])])
                    )
                elif msg["role"] == "assistant":
                    message_history.append(ModelResponse(parts=[msg["content"]]))

            toolsets = []
            if tools:
                toolset = FunctionToolset()
                for tool_func in tools:
                    toolset.add_function(tool_func)
                toolsets.append(toolset)

            if not toolsets:
                result = await self.agent.run(message, message_history=message_history)
            else:
                result = await self.agent.run(
                    message, message_history=message_history, toolsets=toolsets
                )

            response_text = str(result.output)

            return response_text

        except Exception as e:
            logger.error(f"Error in Pydantic AI execution: {e}", exc_info=True)
            raise
