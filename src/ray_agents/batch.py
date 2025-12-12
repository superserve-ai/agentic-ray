"""Batch tool wrapper for parallel execution of Ray tools."""

import inspect
from collections.abc import Callable
from typing import Any, get_type_hints

import ray


def batch(
    tool: Callable,
    max_concurrency: int | None = None,
    description: str | None = None,
) -> Callable:
    """Create a batch version of a @tool decorated function for parallel execution.

    The batch tool allows LLMs to execute multiple instances of the same tool
    in parallel with a single tool call, reducing round trips and improving
    throughput.

    Args:
        tool: A @tool decorated function or from_langchain_tool() result
        max_concurrency: Optional limit on parallel executions (default: unlimited)
        description: Optional custom description for the batch tool

    Returns:
        A new callable that accepts list inputs and executes in parallel

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
    if not hasattr(tool, "_remote_func"):
        raise ValueError(
            f"Tool '{getattr(tool, '__name__', tool)}' is not a valid ray-agents tool. "
            "Use @tool decorator or from_langchain_tool()."
        )

    if not hasattr(tool, "_tool_metadata"):
        raise ValueError(
            f"Tool '{getattr(tool, '__name__', tool)}' is missing _tool_metadata. "
            "Ensure it was decorated with @tool or converted with from_langchain_tool()."
        )

    original_name = tool.__name__
    batch_name = f"{original_name}_batch"
    original_metadata = tool._tool_metadata  # type: ignore[attr-defined]
    original_doc = tool.__doc__ or original_metadata.get("description", "")
    original_remote_func = tool._remote_func

    original_func = tool._original_func  # type: ignore[attr-defined]
    sig = inspect.signature(original_func)
    params = list(sig.parameters.values())
    param_names = [p.name for p in params]
    param_types = _get_param_types(original_func, params)

    if description:
        batch_desc = description
    else:
        batch_desc = (
            f"Batch version of {original_name}. "
            f"Executes multiple {original_name} calls in parallel. "
            f"Original: {original_doc}"
        )

    def _execute_batch(**kwargs: Any) -> list[Any]:
        """Execute multiple tool calls in parallel."""
        inputs = _parse_batch_inputs(kwargs, param_names)

        if not inputs:
            return []

        if max_concurrency is None:
            refs = [original_remote_func.remote(**inp) for inp in inputs]
            return ray.get(refs)
        else:
            results = []
            for i in range(0, len(inputs), max_concurrency):
                batch_inputs = inputs[i : i + max_concurrency]
                refs = [original_remote_func.remote(**inp) for inp in batch_inputs]
                results.extend(ray.get(refs))
            return results

    batch_remote_func = ray.remote(_execute_batch)

    def sync_wrapper(**kwargs: Any) -> list[Any]:
        """Synchronous wrapper for batch execution."""
        return ray.get(batch_remote_func.remote(**kwargs))

    sync_wrapper.__name__ = batch_name
    sync_wrapper.__qualname__ = batch_name
    sync_wrapper.__doc__ = batch_desc

    sync_wrapper._tool_metadata = {  # type: ignore[attr-defined]
        "description": batch_desc,
        "num_cpus": original_metadata.get("num_cpus", 1),
        "num_gpus": original_metadata.get("num_gpus", 0),
        "memory": original_metadata.get("memory"),
        "is_batch": True,
        "original_tool": original_name,
        "max_concurrency": max_concurrency,
    }

    sync_wrapper._remote_func = batch_remote_func  # type: ignore[attr-defined]
    sync_wrapper._original_func = _execute_batch  # type: ignore[attr-defined]
    sync_wrapper._original_tool = tool  # type: ignore[attr-defined]

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
    sync_wrapper.__signature__ = inspect.Signature(batch_params)  # type: ignore[attr-defined]
    sync_wrapper.__annotations__ = batch_annotations

    sync_wrapper.args_schema = _create_batch_args_schema(  # type: ignore[attr-defined]
        batch_name, param_names, param_types
    )

    return sync_wrapper


def _get_param_types(func: Callable, params: list) -> dict[str, type]:
    """Extract parameter types from function signature."""
    try:
        hints = get_type_hints(func)
    except Exception:
        hints = {}

    param_types = {}
    for p in params:
        if p.name in hints:
            param_types[p.name] = hints[p.name]
        else:
            param_types[p.name] = Any

    return param_types


def _parse_batch_inputs(
    kwargs: dict[str, Any], param_names: list[str]
) -> list[dict[str, Any]]:
    """Parse batch inputs from kwargs.

    Supports plural parameter names:
        {"urls": ["url1", "url2"]}

    For multi-param tools:
        {"queries": ["q1", "q2"], "limits": [10, 20]}
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

    if parallel_lists and list_length is not None:
        result: list[dict[str, Any]] = []
        for i in range(list_length):
            inp = {name: vals[i] for name, vals in parallel_lists.items()}
            result.append(inp)
        return result

    raise ValueError(
        f"Invalid batch input. Expected plural parameter names like: "
        f"{_pluralize(param_names[0])}=[value1, value2, ...]"
    )


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
