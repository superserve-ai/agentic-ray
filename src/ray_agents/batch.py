"""Batch tool wrapper for parallel execution of Ray tools."""

import inspect
from collections.abc import Callable
from inspect import Signature
from typing import Any

import ray

from ray_agents.adapters.core import RayTool, to_raytool


def batch(
    tool: Callable | RayTool,
    max_concurrency: int | None = None,
    description: str | None = None,
) -> Callable:
    """Create a batch version of a tool for parallel execution.

    The batch tool allows LLMs to execute multiple instances of the same tool
    in parallel with a single tool call, reducing round trips and improving
    throughput.

    Args:
        tool: Any tool (decorated function, wrapped tool, or RayTool)
        max_concurrency: Optional limit on parallel executions (default: unlimited)
        description: Optional custom description for the batch tool

    Returns:
        A new callable that accepts list inputs and executes in parallel.
        Can be wrapped with RayToolWrapper for framework-specific format.

    Example:
        >>> from ray_agents import tool, batch
        >>>
        >>> @tool(desc="Fetch content from a URL")
        >>> def fetch_url(url: str) -> str:
        ...     return requests.get(url).text
        >>>
        >>> # Create batch version
        >>> fetch_url_batch = batch(fetch_url)
        >>>
        >>> # Call with multiple URLs
        >>> results = fetch_url_batch(urls=["url1", "url2", "url3"])
    """
    if isinstance(tool, RayTool):
        ray_tool = tool
    else:
        ray_tool = to_raytool(tool)

    original_name = ray_tool.name
    batch_name = f"{original_name}_batch"
    original_doc = ray_tool.description
    ray_remote = ray_tool.ray_remote
    input_style = ray_tool.input_style

    param_names = list(ray_tool.annotations.keys())
    param_types = ray_tool.annotations.copy()

    if not param_names and ray_tool.signature:
        param_names = [
            p.name
            for p in ray_tool.signature.parameters.values()
            if p.name not in ("self", "cls")
        ]
        param_types = {
            p.name: p.annotation if p.annotation != inspect.Parameter.empty else Any
            for p in ray_tool.signature.parameters.values()
            if p.name not in ("self", "cls")
        }

    if not param_names:
        raise ValueError(
            f"Cannot create batch for tool '{original_name}': no parameters found. "
            "Ensure the tool has type annotations."
        )

    if description:
        batch_desc = description
    else:
        batch_desc = (
            f"Batch version of {original_name}. "
            f"Executes multiple {original_name} calls in parallel. "
            f"Original: {original_doc}"
        )

    def _make_batch_executor(name: str) -> Any:
        def executor(**kwargs: Any) -> list[Any]:
            """Execute multiple tool calls in parallel."""
            inputs = _parse_batch_inputs(kwargs, param_names, input_style)

            if not inputs:
                return []

            if max_concurrency is None:
                if input_style == "single_input":
                    refs = [ray_remote.remote(inp) for inp in inputs]
                else:
                    refs = [ray_remote.remote(**inp) for inp in inputs]
                return ray.get(refs)
            else:
                results = []
                for i in range(0, len(inputs), max_concurrency):
                    batch_inputs = inputs[i : i + max_concurrency]
                    if input_style == "single_input":
                        refs = [ray_remote.remote(inp) for inp in batch_inputs]
                    else:
                        refs = [ray_remote.remote(**inp) for inp in batch_inputs]
                    results.extend(ray.get(refs))
                return results

        executor.__name__ = name
        executor.__qualname__ = name
        return ray.remote(executor)

    batch_remote_func = _make_batch_executor(batch_name)

    def sync_wrapper(**kwargs: Any) -> list[Any]:
        """Synchronous wrapper for batch execution."""
        result: list[Any] = ray.get(batch_remote_func.remote(**kwargs))
        return result

    sync_wrapper.__name__ = batch_name
    sync_wrapper.__qualname__ = batch_name
    sync_wrapper.__doc__ = batch_desc

    batch_params = []
    batch_annotations = {}
    for name in param_names:
        plural_name = _pluralize(name)
        original_type = param_types.get(name, Any)
        batch_params.append(
            inspect.Parameter(
                plural_name,
                inspect.Parameter.KEYWORD_ONLY,
                annotation=list[original_type],  # type: ignore[valid-type]
            )
        )
        batch_annotations[plural_name] = list[original_type]  # type: ignore[valid-type]

    batch_annotations["return"] = list[Any]
    sync_wrapper.__signature__ = Signature(batch_params)  # type: ignore[attr-defined]
    sync_wrapper.__annotations__ = batch_annotations

    sync_wrapper._remote_func = batch_remote_func  # type: ignore[attr-defined]
    sync_wrapper._original_func = sync_wrapper  # type: ignore[attr-defined]
    sync_wrapper._tool_metadata = {  # type: ignore[attr-defined]
        "desc": batch_desc,
        "is_batch": True,
        "original_tool": original_name,
        "max_concurrency": max_concurrency,
    }

    sync_wrapper.args_schema = _create_batch_args_schema(  # type: ignore[attr-defined]
        batch_name, param_names, param_types
    )

    return sync_wrapper


def _parse_batch_inputs(
    kwargs: dict[str, Any],
    param_names: list[str],
    input_style: str,
) -> list[Any]:
    """Parse batch inputs from kwargs.

    For kwargs-style tools:
        {"urls": ["url1", "url2"]} -> [{"url": "url1"}, {"url": "url2"}]

    For single_input-style tools (LangChain):
        {"querys": ["q1", "q2"]} -> ["q1", "q2"]
    """
    parallel_lists: dict[str, list[Any]] = {}
    list_length: int | None = None

    for param_name in param_names:
        plural_name = _pluralize(param_name)

        if plural_name in kwargs:
            values = kwargs[plural_name]
            if isinstance(values, list):
                parallel_lists[param_name] = values
                current_len = len(values)
                if list_length is None:
                    list_length = current_len
                elif current_len != list_length:
                    raise ValueError(
                        f"All input lists must have same length. "
                        f"'{plural_name}' has {current_len}, expected {list_length}"
                    )

    if not parallel_lists or list_length is None:
        raise ValueError(
            f"Invalid batch input. Expected plural parameter names like: "
            f"{_pluralize(param_names[0])}=[value1, value2, ...]"
        )

    if input_style == "single_input" and len(param_names) == 1:
        return parallel_lists[param_names[0]]
    else:
        result: list[dict[str, Any]] = []
        for i in range(list_length):
            inp = {name: vals[i] for name, vals in parallel_lists.items()}
            result.append(inp)
        return result


def _pluralize(name: str) -> str:
    """Simple pluralization for parameter names."""
    if name.endswith("y") and not name.endswith(("ay", "ey", "oy", "uy")):
        return name[:-1] + "ies"
    elif name.endswith(("s", "x", "z", "ch", "sh")):
        return name + "es"
    else:
        return name + "s"


def _create_batch_args_schema(
    batch_name: str, param_names: list[str], param_types: dict[str, type]
) -> type | None:
    """Create a Pydantic model for batch tool arguments."""
    try:
        from pydantic import Field, create_model

        fields = {}
        for name in param_names:
            original_type = param_types.get(name, Any)
            plural_name = _pluralize(name)
            fields[plural_name] = (
                list[original_type],  # type: ignore[valid-type]
                Field(description=f"List of {name} values to process in parallel"),
            )

        schema: type = create_model(f"{batch_name}Args", **fields)
        return schema

    except ImportError:
        return None
