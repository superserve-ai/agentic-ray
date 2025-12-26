"""Internal core module for cross-framework tool conversion.

This module provides the canonical RayTool intermediate representation
and converters for N+M extensibility when adding new frameworks.
"""

import inspect
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from inspect import Signature
from typing import TYPE_CHECKING, Any

import ray

if TYPE_CHECKING:
    from rayai.adapters.abc import AgentFramework
    from rayai.batch import BatchTool


class SourceFramework(Enum):
    """Detected source framework of an input tool."""

    RAY_TOOL = "ray_tool"
    LANGCHAIN = "langchain"
    PYDANTIC = "pydantic"
    AGNO = "agno"
    CALLABLE = "callable"


@dataclass
class RayTool:
    """Canonical intermediate representation for cross-framework tool conversion.

    This dataclass captures all metadata needed to reconstruct a tool in any
    target framework while executing on Ray workers.
    """

    name: str
    description: str
    ray_remote: Any  # Ray remote function
    func: Callable  # Original underlying function
    args_schema: type | None = None
    signature: Signature | None = None
    annotations: dict[str, Any] = field(default_factory=dict)
    return_annotation: Any = None
    source_framework: str = "unknown"
    # Input style: "kwargs" for **kwargs, "single_input" for single positional arg
    input_style: str = "kwargs"


def _normalize_memory(memory: int | float) -> int:
    """Convert memory spec to bytes."""
    if isinstance(memory, float) and memory < 1024:
        return int(memory * (1024**3))  # Treat as GB
    return int(memory)


def detect_framework(tool: Any) -> SourceFramework:
    """Auto-detect the source framework of an input tool.

    Detection order (most specific first):
    1. Ray @tool decorated - has _remote_func attribute
    2. BatchTool - has _tool_metadata with is_batch_tool
    3. LangChain BaseTool - isinstance check
    4. Pydantic AI Tool - isinstance check
    5. Plain callable - callable() check

    Args:
        tool: The tool to detect

    Returns:
        SourceFramework enum value

    Raises:
        ValueError: If tool is not a recognized type
    """
    # Check for Ray @tool decorated functions first
    if hasattr(tool, "_remote_func") or hasattr(tool, "remote"):
        return SourceFramework.RAY_TOOL

    # Check for BatchTool
    if (
        callable(tool)
        and hasattr(tool, "_tool_metadata")
        and isinstance(tool._tool_metadata, dict)
        and tool._tool_metadata.get("is_batch_tool")
    ):
        return SourceFramework.RAY_TOOL

    # Try LangChain (lazy import to avoid hard dependency)
    try:
        from langchain_core.tools import BaseTool

        if isinstance(tool, BaseTool):
            return SourceFramework.LANGCHAIN
    except ImportError:
        pass

    # Try Pydantic AI (lazy import to avoid hard dependency)
    try:
        from pydantic_ai import Tool as PydanticTool

        if isinstance(tool, PydanticTool):
            return SourceFramework.PYDANTIC
    except ImportError:
        pass

    # Try Agno (Tool-based detection only)
    try:
        from agno.tools import Tool as AgnoTool  # type: ignore[attr-defined]

        if isinstance(tool, AgnoTool):
            return SourceFramework.AGNO
    except Exception:
        # If Agno Tool class is not available, do NOT treat callables as AGNO
        pass

    # Check for plain callable
    if callable(tool):
        return SourceFramework.CALLABLE

    raise ValueError(
        f"Cannot detect framework for tool of type {type(tool).__name__}. "
        "Expected Ray @tool, LangChain BaseTool, Pydantic AI Tool, or callable."
    )


# =============================================================================
# Source Converters (to RayTool)
# =============================================================================


def to_raytool_from_ray_tool(tool: Any) -> RayTool:
    """Convert Ray @tool decorated function to canonical RayTool.

    Already a Ray tool, just extract metadata.
    """
    if hasattr(tool, "_remote_func"):
        remote_func = tool._remote_func
        original_func = getattr(tool, "_original_func", tool)
    else:
        remote_func = tool
        original_func = getattr(tool, "_function", tool)

    # Extract metadata from tool decorator
    metadata = getattr(tool, "_tool_metadata", {})
    name = original_func.__name__
    description = metadata.get("desc", original_func.__doc__ or f"Calls {name}")

    # Get signature and annotations
    try:
        sig = inspect.signature(original_func)
    except (ValueError, TypeError):
        sig = None

    annotations = getattr(original_func, "__annotations__", {}).copy()
    return_annotation = annotations.pop("return", None)

    return RayTool(
        name=name,
        description=description,
        ray_remote=remote_func,
        func=original_func,
        args_schema=getattr(tool, "args_schema", None),
        signature=sig,
        annotations=annotations,
        return_annotation=return_annotation,
        source_framework="ray_tool",
    )


def to_raytool_from_langchain(
    tool: Any,
    num_cpus: int,
    memory_bytes: int,
    num_gpus: int,
) -> RayTool:
    """Convert LangChain BaseTool to canonical RayTool."""
    from langchain_core.tools import BaseTool

    if not isinstance(tool, BaseTool):
        raise ValueError(f"Expected LangChain BaseTool, got {type(tool).__name__}")

    def _make_executor(name: str) -> Any:
        def executor(tool_input: Any) -> Any:
            return tool.invoke(tool_input)

        executor.__name__ = name
        executor.__qualname__ = name
        return ray.remote(num_cpus=num_cpus, memory=memory_bytes, num_gpus=num_gpus)(
            executor
        )

    _execute = _make_executor(tool.name)

    # Extract metadata
    args_schema = getattr(tool, "args_schema", None)

    # Try to get annotations from args_schema
    annotations: dict[str, Any] = {}
    if args_schema and hasattr(args_schema, "model_fields"):
        # Pydantic v2 model - reconstruct annotations
        annotations = {
            name: field_info.annotation
            for name, field_info in args_schema.model_fields.items()
            if field_info.annotation is not None
        }

    # Get the underlying function for signature
    func = tool._run if hasattr(tool, "_run") else tool.invoke

    try:
        sig = inspect.signature(func)
    except (ValueError, TypeError):
        sig = None

    return RayTool(
        name=tool.name,
        description=tool.description,
        ray_remote=_execute,
        func=func,
        args_schema=args_schema,
        signature=sig,
        annotations=annotations,
        return_annotation=str,  # LangChain tools typically return str
        source_framework="langchain",
        input_style="single_input",  # LangChain tools expect single input
    )


def to_raytool_from_pydantic(
    tool: Any,
    num_cpus: int,
    memory_bytes: int,
    num_gpus: int,
) -> RayTool:
    """Convert Pydantic AI Tool to canonical RayTool."""
    try:
        from pydantic_ai import Tool as PydanticTool
    except ImportError:
        raise ImportError(
            "Pydantic AI tool conversion requires 'pydantic-ai'. "
            "Install with: pip install pydantic-ai"
        ) from None

    if not isinstance(tool, PydanticTool):
        raise ValueError(f"Expected Pydantic AI Tool, got {type(tool).__name__}")

    func = tool.function
    tool_name = tool.name or func.__name__
    tool_description = tool.description or func.__doc__ or ""

    def _make_executor(name: str) -> Any:
        def executor(**kwargs: Any) -> Any:
            return func(**kwargs)  # type: ignore[call-arg]

        executor.__name__ = name
        executor.__qualname__ = name
        return ray.remote(num_cpus=num_cpus, memory=memory_bytes, num_gpus=num_gpus)(
            executor
        )

    _execute = _make_executor(tool_name)

    # Extract signature and annotations
    try:
        sig = inspect.signature(func)
    except (ValueError, TypeError):
        sig = None

    annotations = getattr(func, "__annotations__", {}).copy()
    return_annotation = annotations.pop("return", None)

    return RayTool(
        name=tool_name,
        description=tool_description,
        ray_remote=_execute,
        func=func,
        args_schema=None,  # Pydantic AI uses annotations, not schema
        signature=sig,
        annotations=annotations,
        return_annotation=return_annotation,
        source_framework="pydantic",
    )


def to_raytool_from_agno(
    tool: Any,
    num_cpus: int,
    memory_bytes: int,
    num_gpus: int,
) -> RayTool:
    """Convert Agno tool (callable) to canonical RayTool."""
    if not callable(tool):
        raise ValueError(f"Expected Agno tool callable, got {type(tool).__name__}")

    func = tool
    tool_name = getattr(tool, "__name__", "agno_tool")
    tool_description = tool.__doc__ or ""

    def _make_executor(name: str) -> Any:
        def executor(**kwargs: Any) -> Any:
            return func(**kwargs)

        executor.__name__ = name
        executor.__qualname__ = name
        return ray.remote(num_cpus=num_cpus, memory=memory_bytes, num_gpus=num_gpus)(
            executor
        )

    _execute = _make_executor(tool_name)

    try:
        sig = inspect.signature(func)
    except (ValueError, TypeError):
        sig = None

    annotations = getattr(func, "__annotations__", {}).copy()
    return_annotation = annotations.pop("return", None)

    return RayTool(
        name=tool_name,
        description=tool_description,
        ray_remote=_execute,
        func=func,
        args_schema=None,
        signature=sig,
        annotations=annotations,
        return_annotation=return_annotation,
        source_framework="agno",
    )


def to_raytool_from_callable(
    func: Callable,
    num_cpus: int,
    memory_bytes: int,
    num_gpus: int,
) -> RayTool:
    """Convert plain callable to canonical RayTool."""
    tool_name = func.__name__
    tool_description = func.__doc__ or f"Calls {tool_name}"

    def _make_executor(name: str) -> Any:
        def executor(*args: Any, **kwargs: Any) -> Any:
            return func(*args, **kwargs)

        executor.__name__ = name
        executor.__qualname__ = name
        return ray.remote(num_cpus=num_cpus, memory=memory_bytes, num_gpus=num_gpus)(
            executor
        )

    _execute = _make_executor(tool_name)

    # Extract signature and annotations
    try:
        sig = inspect.signature(func)
    except (ValueError, TypeError):
        sig = None

    annotations = getattr(func, "__annotations__", {}).copy()
    return_annotation = annotations.pop("return", None)

    return RayTool(
        name=tool_name,
        description=tool_description,
        ray_remote=_execute,
        func=func,
        args_schema=None,
        signature=sig,
        annotations=annotations,
        return_annotation=return_annotation,
        source_framework="callable",
    )


def to_raytool_from_batch_tool(
    tool: "BatchTool",
    num_cpus: int,
    memory_bytes: int,
    num_gpus: int,
) -> RayTool:
    """Convert BatchTool to canonical RayTool."""
    tool_name = tool.name
    tool_description = tool.description

    def _make_executor(name: str) -> Any:
        def executor(
            tool_name: str, tool_inputs: list[dict[str, Any]]
        ) -> dict[str, Any]:
            return tool(tool_name=tool_name, tool_inputs=tool_inputs)

        executor.__name__ = name
        executor.__qualname__ = name
        return ray.remote(num_cpus=num_cpus, memory=memory_bytes, num_gpus=num_gpus)(
            executor
        )

    ray_remote = _make_executor(tool_name)

    return RayTool(
        name=tool_name,
        description=tool_description,
        ray_remote=ray_remote,
        func=tool.__call__,
        args_schema=tool.args_schema,
        signature=None,
        annotations={"tool_name": str, "tool_inputs": list[dict[str, Any]]},
        return_annotation=dict,
        source_framework="batch_tool",
    )


def to_raytool(
    tool: Any,
    num_cpus: int = 1,
    memory: int | float = 256 * 1024**2,
    num_gpus: int = 0,
) -> RayTool:
    """Convert any supported tool to canonical RayTool.

    Args:
        tool: Tool from any supported framework
        num_cpus: Number of CPUs to allocate
        memory: Memory in bytes (int) or GB (float < 1024)
        num_gpus: Number of GPUs to allocate

    Returns:
        Canonical RayTool representation
    """
    memory_bytes = _normalize_memory(memory)

    # Check for BatchTool first (special case of callable with metadata)
    if (
        callable(tool)
        and hasattr(tool, "_tool_metadata")
        and isinstance(tool._tool_metadata, dict)
        and tool._tool_metadata.get("is_batch_tool")
    ):
        return to_raytool_from_batch_tool(tool, num_cpus, memory_bytes, num_gpus)

    source = detect_framework(tool)

    if source == SourceFramework.RAY_TOOL:
        return to_raytool_from_ray_tool(tool)
    elif source == SourceFramework.LANGCHAIN:
        return to_raytool_from_langchain(tool, num_cpus, memory_bytes, num_gpus)
    elif source == SourceFramework.PYDANTIC:
        return to_raytool_from_pydantic(tool, num_cpus, memory_bytes, num_gpus)
    elif source == SourceFramework.AGNO:
        return to_raytool_from_agno(tool, num_cpus, memory_bytes, num_gpus)
    elif source == SourceFramework.CALLABLE:
        return to_raytool_from_callable(tool, num_cpus, memory_bytes, num_gpus)
    else:
        raise ValueError(f"Unsupported source framework: {source}")


# =============================================================================
# Target Emitters (from RayTool)
# =============================================================================


def _handle_result(result: Any) -> Any:
    """Handle result from Ray task, extracting from status dict if needed."""
    if isinstance(result, dict) and "status" in result:
        if result["status"] == "error":
            error_msg = result.get("error", "Unknown error")
            raise RuntimeError(f"Tool error: {error_msg}")
        if "result" in result:
            return result["result"]
    return result


def from_raytool_to_langchain(ray_tool: RayTool) -> Any:
    """Convert canonical RayTool to LangChain BaseTool."""
    try:
        from langchain_core.tools import BaseTool
    except ImportError:
        raise ImportError(
            "LangChain target requires 'langchain-core'. "
            "Install with: pip install langchain-core"
        ) from None

    ray_remote = ray_tool.ray_remote
    tool_input_style = ray_tool.input_style

    def _normalize_input(*args: Any, **kwargs: Any) -> Any:
        """Normalize input for LangChain tools."""
        if args and not kwargs:
            return args[0] if len(args) == 1 else args
        elif kwargs and not args:
            return next(iter(kwargs.values())) if len(kwargs) == 1 else kwargs
        else:
            return kwargs or ""

    # Generate args_schema from annotations if not present
    tool_args_schema = ray_tool.args_schema
    if tool_args_schema is None and ray_tool.annotations:
        try:
            from pydantic import create_model

            fields = {
                name: (annotation, ...)
                for name, annotation in ray_tool.annotations.items()
            }
            if fields:
                tool_args_schema = create_model(f"{ray_tool.name}Input", **fields)  # type: ignore[call-overload]
        except ImportError:
            pass

    # Capture values for class definition
    _name = ray_tool.name
    _description = ray_tool.description
    _args_schema = tool_args_schema

    class ConvertedLangChainTool(BaseTool):
        name: str = _name
        description: str = _description
        args_schema: type | None = _args_schema

        def _run(self, *args: Any, **kwargs: Any) -> Any:
            if tool_input_style == "single_input":
                tool_input = _normalize_input(*args, **kwargs)
                result = ray.get(ray_remote.remote(tool_input))
            else:
                # Pass args/kwargs directly for Ray tools and callables
                result = ray.get(ray_remote.remote(*args, **kwargs))
            return _handle_result(result)

        async def _arun(self, *args: Any, **kwargs: Any) -> Any:
            if tool_input_style == "single_input":
                tool_input = _normalize_input(*args, **kwargs)
                result = await ray_remote.remote(tool_input)
            else:
                result = await ray_remote.remote(*args, **kwargs)
            return _handle_result(result)

    return ConvertedLangChainTool()


def from_raytool_to_pydantic(ray_tool: RayTool) -> Callable:
    """Convert canonical RayTool to Pydantic AI-compatible callable."""
    ray_remote = ray_tool.ray_remote
    tool_input_style = ray_tool.input_style

    def wrapper(**kwargs: Any) -> Any:
        """Execute tool on Ray worker."""
        if tool_input_style == "single_input":
            # LangChain source tools expect single input
            # Convert kwargs to single value
            if len(kwargs) == 1:
                tool_input = next(iter(kwargs.values()))
            else:
                tool_input = kwargs
            result = ray.get(ray_remote.remote(tool_input))
        else:
            result = ray.get(ray_remote.remote(**kwargs))
        return _handle_result(result)

    # Preserve metadata for Pydantic AI
    wrapper.__name__ = ray_tool.name
    wrapper.__qualname__ = ray_tool.name
    wrapper.__doc__ = ray_tool.description

    # Restore annotations for schema generation
    if ray_tool.annotations:
        wrapper.__annotations__ = ray_tool.annotations.copy()
        if ray_tool.return_annotation:
            wrapper.__annotations__["return"] = ray_tool.return_annotation

    if ray_tool.annotations:
        params = [
            inspect.Parameter(name, inspect.Parameter.KEYWORD_ONLY, annotation=ann)
            for name, ann in ray_tool.annotations.items()
        ]
        return_ann = (
            ray_tool.return_annotation
            if ray_tool.return_annotation
            else inspect.Parameter.empty
        )
        wrapper.__signature__ = Signature(params, return_annotation=return_ann)  # type: ignore[attr-defined]

    return wrapper


def from_raytool_to_agno(ray_tool: RayTool) -> Any:
    """Convert canonical RayTool to an Agno-compatible tool.

    Agno tools are plain callables with annotations.
    No stable Tool base class exists across Agno versions.
    """

    ray_remote = ray_tool.ray_remote

    def wrapper(**kwargs: Any) -> Any:
        """Execute tool on Ray worker."""
        result = ray.get(ray_remote.remote(**kwargs))
        return _handle_result(result)

    # Preserve metadata for Agno
    wrapper.__name__ = ray_tool.name
    wrapper.__qualname__ = ray_tool.name
    wrapper.__doc__ = ray_tool.description

    # Restore annotations for schema generation
    if ray_tool.annotations:
        wrapper.__annotations__ = ray_tool.annotations.copy()
        if ray_tool.return_annotation:
            wrapper.__annotations__["return"] = ray_tool.return_annotation

    return wrapper


def from_raytool(ray_tool: RayTool, target: "AgentFramework") -> Any:
    """Convert canonical RayTool to target framework.

    Args:
        ray_tool: Canonical RayTool representation
        target: Target framework from AgentFramework enum

    Returns:
        Tool compatible with target framework
    """
    # Import here to avoid circular import
    from rayai.adapters.abc import AgentFramework

    if target == AgentFramework.LANGCHAIN:
        return from_raytool_to_langchain(ray_tool)
    elif target == AgentFramework.PYDANTIC:
        return from_raytool_to_pydantic(ray_tool)
    elif target == AgentFramework.AGNO:
        return from_raytool_to_agno(ray_tool)
    else:
        raise ValueError(f"Unsupported target framework: {target}")
