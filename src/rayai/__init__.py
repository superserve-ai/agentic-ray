"""Agentic-Ray - Distributed runtime for AI agents.

Core API:
    - tool: Decorator/wrapper to execute functions on Ray workers
    - serve: Serve agents via HTTP with Ray Serve
    - serve_mcp: Serve MCP servers via HTTP with Ray Serve
    - Agent: Base class for custom agents

Example:
    import rayai
    from pydantic_ai import Agent

    @rayai.tool(num_cpus=1)
    def search(query: str) -> str:
        '''Search the web.'''
        return f"Results for {query}"

    agent = Agent("gpt-4", tools=[search])
    rayai.serve(agent, name="myagent")
"""

import importlib.metadata

from rayai.agent_base import Agent
from rayai.base import AgentProtocol
from rayai.batch import BatchTool, BatchToolInput, BatchToolOutput, batch_tool
from rayai.decorators import tool
from rayai.mcp_serve import serve_mcp
from rayai.serve import is_discovery_mode, serve
from rayai.utils import execute_tools

try:
    __version__ = importlib.metadata.version(__name__)
except importlib.metadata.PackageNotFoundError:
    __version__ = "unknown"

__all__ = [
    # Core API
    "tool",  # Unified decorator/wrapper for Ray tools
    "serve",  # Serve agents via HTTP
    "serve_mcp",  # Serve MCP servers via HTTP
    "is_discovery_mode",  # Check if in rayai up/deploy discovery mode
    "Agent",  # Base class for custom agents
    "batch_tool",
    # Supporting types
    "AgentProtocol",
    "BatchTool",
    "BatchToolInput",
    "BatchToolOutput",
    # Utilities
    "execute_tools",
    # Version
    "__version__",
]
