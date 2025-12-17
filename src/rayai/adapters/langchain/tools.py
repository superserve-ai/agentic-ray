"""Converter for LangChain tools to Ray-executed LangChain tools."""

from typing import Any

import ray


def from_langchain_tool(
    langchain_tool: Any,
    num_cpus: int = 1,
    memory: int | float = 256 * 1024**2,
    num_gpus: int = 0,
) -> Any:
    """Wrap a LangChain tool to execute on Ray workers.

    Returns a LangChain BaseTool that can be used directly with LangChain agents.
    The tool's execution is distributed to Ray workers with the specified resources.

    Args:
        langchain_tool: LangChain tool (BaseTool instance)
        num_cpus: Number of CPUs to allocate (default: 1)
        memory: Memory to allocate in bytes (int) or GB (float < 1024)
        num_gpus: Number of GPUs to allocate (default: 0)

    Returns:
        LangChain BaseTool that executes on Ray workers

    Raises:
        ImportError: If langchain-core is not installed
        ValueError: If tool is not a LangChain BaseTool

    Example:
        ```python
        from langchain.agents import create_agent
        from langchain_community.tools import DuckDuckGoSearchRun
        from rayai.adapters import from_langchain_tool

        # Wrap for Ray execution
        search = from_langchain_tool(DuckDuckGoSearchRun(), num_cpus=1)

        # Use directly with LangChain agent
        agent = create_agent(model="openai:gpt-4o-mini", tools=[search])
        ```
    """
    try:
        from langchain_core.tools import BaseTool
    except ImportError:
        raise ImportError(
            "LangChain tool conversion requires 'langchain-core'. "
            "Install with: pip install langchain-core"
        ) from None

    if not isinstance(langchain_tool, BaseTool):
        raise ValueError(
            f"Expected LangChain BaseTool, got {type(langchain_tool).__name__}"
        )

    if isinstance(memory, float) and memory < 1024:
        memory_bytes = int(memory * (1024**3))
    else:
        memory_bytes = int(memory)

    # Create Ray remote function for tool execution
    @ray.remote(num_cpus=num_cpus, memory=memory_bytes, num_gpus=num_gpus)
    def _execute_tool(tool_input: Any) -> Any:
        return langchain_tool.invoke(tool_input)

    def _normalize_input(*args: Any, **kwargs: Any) -> Any:
        """Normalize input for LangChain tools."""
        if args and not kwargs:
            return args[0] if len(args) == 1 else args
        elif kwargs and not args:
            return next(iter(kwargs.values())) if len(kwargs) == 1 else kwargs
        else:
            return kwargs or ""

    # Create a new tool class that wraps execution in Ray
    class RayLangChainTool(BaseTool):
        name: str = langchain_tool.name
        description: str = langchain_tool.description
        args_schema: type | None = getattr(langchain_tool, "args_schema", None)

        def _run(self, *args: Any, **kwargs: Any) -> Any:
            tool_input = _normalize_input(*args, **kwargs)
            return ray.get(_execute_tool.remote(tool_input))

        async def _arun(self, *args: Any, **kwargs: Any) -> Any:
            tool_input = _normalize_input(*args, **kwargs)
            # Ray ObjectRefs are awaitable
            return await _execute_tool.remote(tool_input)

    return RayLangChainTool()
