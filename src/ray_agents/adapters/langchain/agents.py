"""LangChain agent adapter for Ray distributed tool execution."""

import functools
import logging
from collections.abc import Callable
from typing import Any

import ray

from ray_agents.adapters.abc import AgentAdapter

logger = logging.getLogger(__name__)


class LangChainAdapter(AgentAdapter):
    """
    Adapter for LangChain agents with Ray distributed tool execution.

    This adapter wraps LangChain's native agent execution (ReAct pattern, tool
    calling) while executing tools as Ray tasks. LangChain maintains full control
    over the agent flow; Ray provides distributed execution.

    When LangChain calls a tool, it's actually executing:
        result = ray.get(tool.remote(**args))

    This means tools automatically run on cluster nodes with appropriate resources.

    Example:
        >>> from ray_agents.adapters.langchain import LangChainAdapter
        >>> from langchain_openai import ChatOpenAI
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
        >>> # Create adapter with any LangChain LLM
        >>> llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)
        >>> adapter = LangChainAdapter(llm=llm)
        >>>
        >>> # Use with AgentSession for stateful conversations
        >>> from ray_agents import AgentSession
        >>> session = AgentSession.remote("user_id", adapter=adapter)
        >>> result = ray.get(session.run.remote(
        ...     "Use the available tools to help me",
        ...     tools=[tool_a, tool_b]
        ... ))

    Works with any LangChain LLM provider (ChatOpenAI, ChatAnthropic, etc.).
    """

    def __init__(
        self,
        llm: Any,
        system_prompt: str | None = None,
    ):
        """
        Initialize LangChain agent adapter.

        Args:
            llm: Pre-configured LangChain LLM (ChatOpenAI, ChatAnthropic, etc.)
                 User has full control over model, temperature, API keys, etc.
            system_prompt: Optional system prompt for the agent

        Example:
            >>> from langchain_openai import ChatOpenAI
            >>> llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)
            >>> adapter = LangChainAdapter(llm=llm)
        """
        self.llm = llm
        self.system_prompt = system_prompt or "You are a helpful AI assistant."
        self._agent: Any | None = None
        self._cached_tool_signature: tuple | None = None

    async def run(
        self, message: str, messages: list[dict], tools: list[Any]
    ) -> dict[str, Any]:
        """
        Execute LangChain agent with Ray distributed tools.

        Flow:
        1. Convert Ray remote functions → LangChain Tool format
        2. Create LangChain agent with create_agent()
        3. Agent executes its ReAct loop (decides which tools to call)
        4. When tool is called, Ray executes it distributed
        5. LangChain generates final response

        Args:
            message: Current user message
            messages: Conversation history
            tools: List of Ray remote functions

        Returns:
            Response dict with 'content' key and metadata
        """
        try:
            langchain_tools = self._wrap_ray_tools_for_langchain(tools)
            response_text = await self._execute_agent(
                message, messages, langchain_tools
            )

            return {
                "content": response_text,
                "tools_available": len(tools),
                "llm": type(self.llm).__name__,
            }

        except Exception as e:
            logger.error(f"Error in LangChain adapter: {e}")
            raise

    def _wrap_ray_tools_for_langchain(self, ray_tools: list[Any]) -> list[Callable]:
        """
        Wrap Ray remote functions as LangChain-compatible callables.

        This is the key integration point: when LangChain calls these tools,
        they execute as Ray tasks (distributed across cluster).

        Note: create_agent() uses LangGraph under the hood, which supports
        parallel tool execution when the agent decides to call multiple tools.

        Args:
            ray_tools: List of Ray remote functions

        Returns:
            List of callables that LangChain can use as tools
        """
        wrapped_tools = []

        for ray_tool in ray_tools:
            if hasattr(ray_tool, "_remote_func") and hasattr(ray_tool, "args_schema"):
                wrapped_tools.append(ray_tool)
                continue
            elif hasattr(ray_tool, "remote"):
                remote_func = ray_tool
            elif hasattr(ray_tool, "_remote_func"):
                remote_func = ray_tool._remote_func
            else:
                logger.warning(
                    f"Tool {ray_tool} is not a Ray remote function, skipping"
                )
                continue

            def make_wrapper(tool, original_tool):
                """Create wrapper that preserves signature for LangChain."""
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

                    if isinstance(result, dict) and "status" in result:
                        if result["status"] == "error":
                            error_msg = result.get("error", "Unknown error")
                            raise RuntimeError(f"Tool error: {error_msg}")
                        if "result" in result:
                            result = result["result"]

                    return result

                return sync_wrapper

            wrapped_tools.append(make_wrapper(remote_func, ray_tool))

        return wrapped_tools

    def _get_or_create_agent(self, lc_tools: list[Any]) -> Any:
        """
        Get cached agent or create new one if tools changed.

        Only recreates the agent if the set of tools has changed,
        improving performance for repeated calls with same tools.

        Args:
            lc_tools: List of LangChain StructuredTool objects

        Returns:
            Cached or newly created LangChain agent
        """
        tool_signature = tuple(sorted(tool.name for tool in lc_tools))

        if self._agent is None or self._cached_tool_signature != tool_signature:
            from langchain.agents import create_agent

            self._agent = create_agent(self.llm, tools=lc_tools)
            self._cached_tool_signature = tool_signature

        return self._agent

    async def _execute_agent(
        self, message: str, messages: list[dict], tools: list[Callable]
    ) -> str:
        """
        Execute LangChain agent with tool calling.

        Uses LangChain's create_agent() to create a ReAct agent that can
        reason about which tools to use and call them as needed.

        Args:
            message: User message
            messages: Conversation history
            tools: Wrapped tools (execute via Ray when called)

        Returns:
            Response text from agent
        """
        try:
            from langchain_core.messages import (
                AIMessage,
                BaseMessage,
                HumanMessage,
                SystemMessage,
            )

            conversation_history: list[BaseMessage] = [
                SystemMessage(content=self.system_prompt)
            ]

            for msg in messages:
                if msg["role"] == "user":
                    conversation_history.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "assistant":
                    conversation_history.append(AIMessage(content=msg["content"]))

            conversation_history.append(HumanMessage(content=message))

            if not tools:
                response = await self.llm.ainvoke(conversation_history)
                return str(response.content)

            try:
                import langchain  # noqa: F401
            except ImportError as e:
                raise ImportError(
                    "LangChain agent requires 'langchain'. "
                    "Install with: pip install langchain"
                ) from e

            from langchain_core.tools import StructuredTool

            lc_tools = []
            for wrapped_tool in tools:
                try:
                    tool_name = wrapped_tool.__name__
                    tool_desc = wrapped_tool.__doc__ or f"Calls {tool_name}"
                    args_schema = getattr(wrapped_tool, "args_schema", None)

                    structured_tool = StructuredTool.from_function(
                        func=wrapped_tool,
                        name=tool_name,
                        description=tool_desc,
                        args_schema=args_schema,
                    )
                    lc_tools.append(structured_tool)
                except Exception as e:
                    logger.error(
                        f"Failed to create tool from {wrapped_tool.__name__}: {e}",
                        exc_info=True,
                    )

            if not lc_tools:
                raise ValueError("No tools could be created")

            agent = self._get_or_create_agent(lc_tools)

            try:
                result = await agent.ainvoke({"messages": conversation_history})

                final_message = result["messages"][-1]
                response_content = str(final_message.content)

                return response_content

            except Exception as e:
                logger.error(f"Error during agent execution: {e}", exc_info=True)
                raise

        except Exception as e:
            logger.error(f"Error in LangChain execution: {e}")
            raise
