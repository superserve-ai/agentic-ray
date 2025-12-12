"""Converter for LangChain tools to Ray-compatible tools."""

from collections.abc import Callable
from typing import Any

import ray


def from_langchain_tool(langchain_tool: Any) -> Callable:
    """Convert a LangChain tool to a Ray-compatible remote function.

    Args:
        langchain_tool: LangChain tool (BaseTool instance)

    Returns:
        Ray remote function

    Raises:
        ImportError: If langchain-core is not installed
        ValueError: If tool is not a LangChain BaseTool
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

    tool_name = langchain_tool.name
    tool_description = langchain_tool.description

    def _normalize_input(kwargs: dict[str, Any]) -> str | dict[str, Any]:
        """Normalize kwargs to format expected by LangChain tools."""
        if len(kwargs) == 1:
            return next(iter(kwargs.values()))  # type: ignore[no-any-return]
        elif len(kwargs) == 0:
            return ""
        else:
            return kwargs

    def _create_dynamic_wrapper(
        lc_tool: Any, name: str, args_schema: Any = None
    ) -> Callable:
        """
        Create a wrapper function with proper signature based on args_schema.

        This ensures LLMs can see the required
        parameters and their types, rather than just **kwargs.

        Uses exec() to dynamically create a real function with proper parameters
        so that typing.get_type_hints() works correctly.
        """
        if args_schema is None:
            return _create_simple_wrapper(lc_tool, name)

        try:
            if hasattr(args_schema, "model_fields"):
                fields = args_schema.model_fields
            elif hasattr(args_schema, "__fields__"):
                fields = args_schema.__fields__
            else:
                return _create_simple_wrapper(lc_tool, name)
        except Exception:
            return _create_simple_wrapper(lc_tool, name)

        if not fields:
            return _create_simple_wrapper(lc_tool, name)

        param_strings = []
        param_docs = []
        annotations = {}

        for field_name, field_info in fields.items():
            if hasattr(field_info, "annotation"):
                field_type = field_info.annotation
            else:
                field_type = Any

            annotations[field_name] = field_type

            if hasattr(field_info, "description") and field_info.description:
                param_docs.append(f"        {field_name}: {field_info.description}")

            is_required = getattr(field_info, "is_required", lambda: True)()
            if callable(is_required):
                is_required = is_required()

            if is_required:
                param_strings.append(f"{field_name}")
            else:
                default_val = getattr(field_info, "default", None)
                if default_val is None:
                    param_strings.append(f"{field_name}=None")
                else:
                    param_strings.append(f"{field_name}={repr(default_val)}")

        base_doc = lc_tool.description or f"Calls {name}"
        if param_docs:
            full_doc = f"{base_doc}\n\n    Args:\n" + "\n".join(param_docs)
        else:
            full_doc = base_doc

        params_str = ", ".join(param_strings)
        func_code = f"""
def {name}({params_str}):
    \"\"\"Dynamically generated wrapper\"\"\"
    kwargs = {{{', '.join(f"'{k}': {k}" for k in fields.keys())}}}
    return _tool_executor(kwargs)

async def {name}_async({params_str}):
    \"\"\"Async version\"\"\"
    kwargs = {{{', '.join(f"'{k}': {k}" for k in fields.keys())}}}
    return await _async_tool_executor(kwargs)
"""

        def _tool_executor(kwargs: dict[str, Any]) -> dict[str, Any]:
            try:
                tool_input = _normalize_input(kwargs)
                result = lc_tool.invoke(tool_input)
                return {
                    "result": result,
                    "status": "success",
                    "tool": name,
                }
            except Exception as e:
                return {
                    "error": str(e),
                    "status": "error",
                    "tool": name,
                }

        async def _async_tool_executor(kwargs: dict[str, Any]) -> dict[str, Any]:
            try:
                tool_input = _normalize_input(kwargs)
                result = await lc_tool.ainvoke(tool_input)
                return {
                    "result": result,
                    "status": "success",
                    "tool": name,
                }
            except Exception as e:
                return {
                    "error": str(e),
                    "status": "error",
                    "tool": name,
                }

        local_vars: dict[str, Any] = {
            "_tool_executor": _tool_executor,
            "_async_tool_executor": _async_tool_executor,
        }
        exec(func_code, local_vars)

        wrapper = local_vars[name]
        async_wrapper = local_vars[f"{name}_async"]

        wrapper.__annotations__ = {**annotations, "return": dict[str, Any]}
        async_wrapper.__annotations__ = {**annotations, "return": dict[str, Any]}

        wrapper.__doc__ = full_doc
        async_wrapper.__doc__ = full_doc

        wrapper._async = async_wrapper

        return wrapper  # type: ignore[no-any-return]

    def _create_simple_wrapper(lc_tool: Any, name: str) -> Callable:
        """Fallback wrapper when no args_schema is available."""

        def wrapper(**kwargs: Any) -> dict[str, Any]:
            try:
                tool_input = _normalize_input(kwargs)
                result = lc_tool.invoke(tool_input)
                return {
                    "result": result,
                    "status": "success",
                    "tool": name,
                }
            except Exception as e:
                return {
                    "error": str(e),
                    "status": "error",
                    "tool": name,
                }

        async def async_wrapper(**kwargs: Any) -> dict[str, Any]:
            """Async version for LangGraph compatibility."""
            try:
                tool_input = _normalize_input(kwargs)
                result = await lc_tool.ainvoke(tool_input)
                return {
                    "result": result,
                    "status": "success",
                    "tool": name,
                }
            except Exception as e:
                return {
                    "error": str(e),
                    "status": "error",
                    "tool": name,
                }

        wrapper.__name__ = name
        wrapper.__qualname__ = name
        wrapper.__doc__ = lc_tool.description
        wrapper._async = async_wrapper  # type: ignore[attr-defined]
        return wrapper

    args_schema = (
        langchain_tool.args_schema if hasattr(langchain_tool, "args_schema") else None
    )

    tool_wrapper = _create_dynamic_wrapper(langchain_tool, tool_name, args_schema)

    ray_remote_func = ray.remote(tool_wrapper)

    def sync_wrapper(**kwargs: Any) -> dict[str, Any]:
        """Synchronous wrapper that executes the Ray remote function."""
        return ray.get(ray_remote_func.remote(**kwargs))  # type: ignore[no-any-return]

    async def async_wrapper(**kwargs: Any) -> dict[str, Any]:
        """Async wrapper that enables parallel execution."""
        object_ref = ray_remote_func.remote(**kwargs)
        return await object_ref  # type: ignore[no-any-return]

    sync_wrapper.__name__ = tool_name
    sync_wrapper.__doc__ = tool_description
    sync_wrapper._remote_func = ray_remote_func  # type: ignore[attr-defined]
    sync_wrapper._async = async_wrapper  # type: ignore[attr-defined]

    if hasattr(tool_wrapper, "__signature__"):
        sync_wrapper.__signature__ = tool_wrapper.__signature__  # type: ignore[attr-defined]
        async_wrapper.__signature__ = tool_wrapper.__signature__  # type: ignore[attr-defined]

    if hasattr(tool_wrapper, "__annotations__"):
        sync_wrapper.__annotations__ = tool_wrapper.__annotations__
        async_wrapper.__annotations__ = tool_wrapper.__annotations__

    if (
        hasattr(langchain_tool, "args_schema")
        and langchain_tool.args_schema is not None
    ):
        sync_wrapper.args_schema = langchain_tool.args_schema  # type: ignore[attr-defined]
        async_wrapper.args_schema = langchain_tool.args_schema  # type: ignore[attr-defined]

    return sync_wrapper
