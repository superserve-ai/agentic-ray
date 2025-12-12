"""Decorators for Ray agents."""

from collections.abc import Callable
from typing import Any

import ray


def tool(
    func: Callable | None = None,
    *,
    desc: str = "",
) -> Callable:
    """Convert function to directly callable tool that executes on Ray.

    Args:
        func: The function to decorate (when used as @tool without parentheses)
        desc: Tool description for LLM schema generation

    Returns:
        Decorated function that executes on Ray

    Example:
        @tool
        def my_tool(x: str) -> str:
            return x

        @tool()
        def another_tool(x: str) -> str:
            return x

        @tool(desc="Custom description")
        def described_tool(x: str) -> str:
            return x
    """

    def decorator(f: Callable) -> Callable:
        remote_func = ray.remote(f)

        def sync_wrapper(*args, **kwargs) -> Any:
            """Synchronous wrapper that executes tool on Ray and waits for result."""
            return ray.get(remote_func.remote(*args, **kwargs))

        sync_wrapper._tool_metadata = {  # type: ignore[attr-defined]
            "description": desc or f.__doc__ or f.__name__,
        }

        sync_wrapper._original_func = f  # type: ignore[attr-defined]
        sync_wrapper._remote_func = remote_func  # type: ignore[attr-defined]

        sync_wrapper.__name__ = f.__name__
        sync_wrapper.__doc__ = f.__doc__

        return sync_wrapper

    if func is not None:
        return decorator(func)
    return decorator


def agent(cls: type | None = None) -> type | Callable[[type], type]:
    """Mark a class as a servable agent.

    The decorated class must have a run(data: dict) -> dict method.

    Example:
        @agent
        class MyAgent:
            def run(self, data: dict) -> dict:
                return {"response": "Hello!"}

        # Or with parentheses
        @agent()
        class AnotherAgent:
            def run(self, data: dict) -> dict:
                return {"response": "Hello!"}
    """

    def decorator(c: type) -> type:
        if not callable(getattr(c, "run", None)):
            raise TypeError(
                f"Agent class {c.__name__} must have a run(data: dict) -> dict method"
            )
        c._is_rayai_agent = True  # type: ignore[attr-defined]
        return c

    if cls is not None:
        return decorator(cls)
    return decorator
