"""Simple tools for the Agno demo agent using Ray execution."""

from rayai import tool


@tool(desc="Echo back the given message", num_cpus=1)
def echo(message: str) -> str:
    """Echo the input message."""
    return f"Echo from Ray: {message}"


@tool(desc="Add two integers", num_cpus=1)
def add(x: int, y: int) -> int:
    """Add two integers and return the sum."""
    return x + y
