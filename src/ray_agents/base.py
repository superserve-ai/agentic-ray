"""Base classes for Agentic-Ray framework."""

from abc import ABC, abstractmethod
from typing import Any


class RayAgent(ABC):
    """Abstract base class for all Agentic-Ray agents.

    All agents must inherit from this class and implement the required methods.
    This ensures a consistent interface across all agents in the framework.
    """

    def __init__(self):  # noqa: B027
        """Initialize the agent.

        Subclasses should call super().__init__() and add their own initialization.
        """
        pass

    @abstractmethod
    def run(self, data: dict[str, Any]) -> dict[str, Any]:
        """Main entry point for agent execution.

        This method MUST be implemented by all agents.

        Args:
            data: Input data from the client request

        Returns:
            Dict containing the agent's response

        Raises:
            NotImplementedError: If not implemented by subclass
        """
        raise NotImplementedError("Agents must implement the run() method")
