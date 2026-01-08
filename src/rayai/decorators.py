"""Decorators for Ray-distributed tool execution.

The `@tool` decorator makes functions execute on Ray workers with configurable
resources. It works as both a decorator and wrapper for framework tools.

Example:
    import rayai

    # As decorator for custom functions
    @rayai.tool
    def search(query: str) -> str:
        '''Search the web.'''
        return results

    # As decorator with explicit resources
    @rayai.tool(num_cpus=2, memory="4GB")
    def expensive_task(data: str) -> str:
        return process(data)

    # As wrapper for framework tools
    from langchain_community.tools import DuckDuckGoSearchRun
    lc_search = rayai.tool(DuckDuckGoSearchRun())
"""

from __future__ import annotations

import asyncio
import functools
from collections.abc import Callable
from typing import Any, overload

import ray

from rayai.resource_loader import _parse_memory


@overload
def tool[F: Callable[..., Any]](func: F) -> F: ...


@overload
def tool[F: Callable[..., Any]](
    func: None = None,
    *,
    num_cpus: int | float | None = None,
    num_gpus: int | float | None = None,
    memory: str | None = None,
) -> Callable[[F], F]: ...


@overload
def tool(
    func: Any,
    *,
    num_cpus: int | float | None = None,
    num_gpus: int | float | None = None,
    memory: str | None = None,
) -> Callable[..., Any]: ...


def tool(
    func: Callable[..., Any] | Any | None = None,
    *,
    num_cpus: int | float | None = None,
    num_gpus: int | float | None = None,
    memory: str | None = None,
) -> Callable[..., Any]:
    """Make a function execute on Ray workers with distributed resources.

    Works as both a decorator and wrapper:
        @rayai.tool
        def my_func(): ...

        @rayai.tool(num_cpus=2, memory="4GB")
        def my_func(): ...

        wrapped = rayai.tool(LangChainTool())

    Args:
        func: Function to wrap, or a framework tool instance.
        num_cpus: Number of CPU cores (default: 1).
        num_gpus: Number of GPUs (default: 0).
        memory: Memory requirement as string (e.g., "4GB", "512MB").

    Returns:
        Async callable that executes on Ray workers.
        Use asyncio.gather() to run multiple tools in parallel.
    """

    def make_ray_tool(fn: Callable[..., Any]) -> Callable[..., Any]:
        """Create a Ray-distributed async wrapper for a function."""
        # Use decorator args or defaults
        resolved_cpus = num_cpus if num_cpus is not None else 1
        resolved_gpus = num_gpus if num_gpus is not None else 0
        resolved_memory = memory

        # Lazy initialization - Ray remote function created on first call
        _remote_fn_cache: list[Any] = []

        def _get_remote_fn() -> Any:
            """Get or create the Ray remote function (lazy init)."""
            if not _remote_fn_cache:
                # Auto-init Ray if needed (deferred until first call)
                if not ray.is_initialized():
                    ray.init()

                # Build Ray options
                ray_options: dict[str, Any] = {
                    "num_cpus": resolved_cpus,
                    "num_gpus": resolved_gpus,
                }
                if resolved_memory:
                    ray_options["memory"] = _parse_memory(resolved_memory)

                # Create Ray remote function
                _remote_fn_cache.append(ray.remote(**ray_options)(fn))

            return _remote_fn_cache[0]

        # Async wrapper for non-blocking parallel execution
        @functools.wraps(fn)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            """Async wrapper - non-blocking, parallelizable with asyncio.gather()."""
            remote_fn = _get_remote_fn()
            ref = remote_fn.remote(*args, **kwargs)
            # Use asyncio to await Ray ObjectRef without blocking event loop
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, ray.get, ref)

        # Store metadata for introspection
        async_wrapper._rayai_tool = True  # type: ignore[attr-defined]
        async_wrapper._get_remote_func = _get_remote_fn  # type: ignore[attr-defined]
        async_wrapper._original_func = fn  # type: ignore[attr-defined]
        async_wrapper._tool_metadata = {  # type: ignore[attr-defined]
            "description": fn.__doc__ or f"Calls {fn.__name__}",
            "num_cpus": resolved_cpus,
            "num_gpus": resolved_gpus,
            "memory": resolved_memory,
        }

        return async_wrapper

    # Detect usage pattern
    if func is None:
        # @tool(num_cpus=2) - decorator with args
        return make_ray_tool

    if callable(func) and not _is_framework_tool(func):
        # @tool - decorator without args on a plain function
        return make_ray_tool(func)

    # tool(FrameworkTool()) - wrapping a framework tool
    return _wrap_framework_tool(func, num_cpus, num_gpus, memory)


def _is_framework_tool(obj: Any) -> bool:
    """Check if obj is a framework tool (LangChain, Pydantic AI).

    Returns True if the object appears to be a tool from a supported framework,
    rather than a plain Python function.
    """
    # Check for LangChain BaseTool
    if _is_langchain_tool(obj):
        return True

    # Check for Pydantic AI Tool
    if _is_pydantic_tool(obj):
        return True

    return False


def _is_langchain_tool(obj: Any) -> bool:
    """Check if obj is a LangChain BaseTool."""
    try:
        from langchain_core.tools import BaseTool

        return isinstance(obj, BaseTool)
    except ImportError:
        return False


def _is_pydantic_tool(obj: Any) -> bool:
    """Check if obj is a Pydantic AI Tool."""
    try:
        from pydantic_ai import Tool

        return isinstance(obj, Tool)
    except ImportError:
        pass

    # Also check for pydantic_ai.tools.Tool
    try:
        from pydantic_ai.tools import Tool

        return isinstance(obj, Tool)
    except ImportError:
        pass

    return False


def _wrap_framework_tool(
    framework_tool: Any,
    num_cpus: int | float | None,
    num_gpus: int | float | None,
    memory: str | None,
) -> Callable[..., Any]:
    """Wrap a framework tool for Ray execution.

    Auto-detects the framework and extracts the underlying callable,
    then wraps it for Ray distributed execution.

    Args:
        framework_tool: A tool instance from LangChain or Pydantic AI.
        num_cpus: CPU cores override.
        num_gpus: GPU count override.
        memory: Memory requirement override.

    Returns:
        Async callable that executes the tool on Ray workers.
    """
    # Extract the underlying callable based on framework
    fn: Callable[..., Any]
    if _is_langchain_tool(framework_tool):
        fn = _extract_langchain_callable(framework_tool)
    elif _is_pydantic_tool(framework_tool):
        fn = _extract_pydantic_callable(framework_tool)
    elif callable(framework_tool):
        fn = framework_tool
    else:
        raise TypeError(
            f"Cannot wrap {type(framework_tool).__name__}: "
            "not a recognized framework tool or callable"
        )

    # Apply the tool decorator to the extracted function
    return tool(fn, num_cpus=num_cpus, num_gpus=num_gpus, memory=memory)


def _extract_langchain_callable(lc_tool: Any) -> Callable[..., Any]:
    """Extract the underlying callable from a LangChain tool."""
    tool_name = getattr(lc_tool, "name", type(lc_tool).__name__)
    tool_desc = getattr(lc_tool, "description", None)

    def lc_wrapper(input: Any = None, **kwargs: Any) -> Any:
        if input is not None:
            return lc_tool.invoke(input, **kwargs)
        return lc_tool.invoke(**kwargs)

    lc_wrapper.__name__ = tool_name
    lc_wrapper.__qualname__ = tool_name
    lc_wrapper.__doc__ = tool_desc

    return lc_wrapper


def _extract_pydantic_callable(pydantic_tool: Any) -> Callable[..., Any]:
    """Extract the underlying callable from a Pydantic AI tool."""
    # Pydantic AI tools have a function attribute
    fn: Callable[..., Any]
    if hasattr(pydantic_tool, "function"):
        fn = pydantic_tool.function
        return fn
    if hasattr(pydantic_tool, "func"):
        fn = pydantic_tool.func
        return fn

    # Fall back to calling directly
    if callable(pydantic_tool):
        fn = pydantic_tool
        return fn

    raise TypeError(f"Cannot extract callable from Pydantic AI tool: {pydantic_tool}")
