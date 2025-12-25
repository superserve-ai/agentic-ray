"""Ray tool wrapper for agent frameworks."""

import logging
from collections.abc import Callable
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class AgentFramework(Enum):
    """Supported agent frameworks."""

    LANGCHAIN = "langchain"
    PYDANTIC = "pydantic"
    AGNO = "agno"


class RayToolWrapper:
    """
    Wrapper for converting tools to framework-compatible callables.

    Supports cross-framework conversion: tools from any supported framework
    (LangChain, Pydantic AI, plain callables, or Ray @tool decorated functions)
    can be converted to any target framework.

    Example:
        # Convert Ray @tool decorated functions to LangChain
        wrapper = RayToolWrapper(framework=AgentFramework.LANGCHAIN)
        lc_tools = wrapper.wrap_tools([my_ray_tool])

        # Cross-framework: LangChain tools to Pydantic
        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        pydantic_tools = wrapper.wrap_tools([langchain_search_tool], num_cpus=2)

        # Mix tools from different frameworks
        wrapper = RayToolWrapper(framework=AgentFramework.PYDANTIC)
        tools = wrapper.wrap_tools([langchain_tool, pydantic_tool, plain_func])
    """

    def __init__(self, framework: AgentFramework):
        """
        Initialize tool wrapper.

        Args:
            framework: Target agent framework for tool wrapping
        """
        self.framework = framework

    def wrap_tools(
        self,
        tools: list[Any],
        num_cpus: int = 1,
        memory: int | float = 256 * 1024**2,
        num_gpus: int = 0,
    ) -> list[Callable]:
        """
        Wrap tools as framework-compatible callables.

        Auto-detects the source framework (Ray @tool, LangChain, Pydantic AI,
        or plain callable) and converts each tool to the target framework.
        All tool execution is distributed to Ray workers.

        Args:
            tools: List of tools from any supported framework:
                - Ray @tool decorated functions
                - LangChain BaseTool instances
                - Pydantic AI Tool instances
                - Plain Python callables
            num_cpus: Number of CPUs to allocate per tool invocation (default: 1)
            memory: Memory allocation - int for bytes, float < 1024 for GB (default: 256MB)
            num_gpus: Number of GPUs to allocate (default: 0)

        Returns:
            List of wrapped callables compatible with the target framework
        """
        from rayai.adapters.core import from_raytool, to_raytool

        wrapped_tools = []

        for tool in tools:
            try:
                ray_tool = to_raytool(tool, num_cpus, memory, num_gpus)
                wrapped = from_raytool(ray_tool, self.framework)
                wrapped_tools.append(wrapped)
            except ValueError as e:
                logger.warning(f"Could not convert tool {tool}: {e}")
                continue

        return wrapped_tools
