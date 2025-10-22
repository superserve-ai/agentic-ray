"""
Code Interpreter Demo

This example demonstrates how to use the Ray Code Interpreter with agents.
The agent can execute Python code, install packages, and work with files
in isolated Docker containers.

Requirements:
    - Docker installed and running
    - gVisor (optional, for enhanced security): sudo apt-get install runsc
    - OpenAI API key: export OPENAI_API_KEY=your-key

Usage:
    python -m ray_agents.examples.code_interpreter_demo
"""

import logging
import os

import ray

from ray_agents import AgentSession
from ray_agents.adapters.langgraph import LangGraphAdapter
from ray_agents.code_interpreter import (
    cleanup_session,
    execute_code,
    install_package,
    upload_file,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def main():
    """Run code interpreter demo with LangGraph agent"""

    # Check for OpenAI API key
    if not os.environ.get("OPENAI_API_KEY"):
        logger.error("OPENAI_API_KEY environment variable not set")
        logger.info("Set it with: export OPENAI_API_KEY=your-key")
        return

    # Initialize Ray
    logger.info("Initializing Ray...")
    ray.init(ignore_reinit_error=True, num_cpus=8)

    # Use a single session ID for all code interpreter executions
    code_session_id = "demo-session"

    try:
        # Create adapter with code execution tools
        logger.info("Creating LangGraph adapter...")
        system_prompt = """You are a helpful AI assistant with access to code execution tools.

CRITICAL RULES:
1. Variables and packages persist across all code executions in your session
2. When you complete a task successfully, provide a clear answer and STOP - don't keep retrying
3. If a tool returns an error, try once more with a fix, then explain the issue to the user

Example tool usage:
- execute_code(code="x = 42")
- install_package(package="pandas")
- upload_file(path="/tmp/data.csv", content=b"data")"""

        adapter = LangGraphAdapter(
            model="gpt-4o-mini",
            system_prompt=system_prompt,
            default_tool_params={"session_id": code_session_id},
        )

        # Create agent session
        logger.info("Creating agent session...")
        session = AgentSession.remote(
            session_id="code-interpreter-demo", adapter=adapter
        )

        # Define available tools - session_id will be injected automatically
        tools = [execute_code, install_package, upload_file]

        # Example 1: Basic calculation
        logger.info("\n" + "=" * 60)
        logger.info("Example 1: Calculate Fibonacci sequence")
        logger.info("=" * 60)

        response1 = ray.get(
            session.run.remote(
                message="Calculate the first 10 Fibonacci numbers and print them",
                tools=tools,
            )
        )
        logger.info(f"Agent response: {response1['content']}")

        # Example 2: Data analysis (requires package installation)
        logger.info("\n" + "=" * 60)
        logger.info("Example 2: Data analysis with pandas")
        logger.info("=" * 60)

        response2 = ray.get(
            session.run.remote(
                message=(
                    "Create a simple dataset with 3 columns (name, age, city) "
                    "and 5 rows. Then calculate the average age. "
                    "Use pandas if you need to."
                ),
                tools=tools,
            )
        )
        logger.info(f"Agent response: {response2['content']}")

        # Example 3: File operations
        logger.info("\n" + "=" * 60)
        logger.info("Example 3: Working with files")
        logger.info("=" * 60)

        response3 = ray.get(
            session.run.remote(
                message=(
                    "Write a Python function that reads a CSV file and returns "
                    "the number of rows. Demonstrate it with a sample CSV."
                ),
                tools=tools,
            )
        )
        logger.info(f"Agent response: {response3['content']}")

        # Example 4: Session persistence
        logger.info("\n" + "=" * 60)
        logger.info("Example 4: Session persistence")
        logger.info("=" * 60)

        # First query sets a variable
        response4a = ray.get(
            session.run.remote(
                message="Set a variable called 'secret_number' to 42",
                tools=tools,
            )
        )
        logger.info(f"Agent response: {response4a['content']}")

        # Second query uses the variable
        response4b = ray.get(
            session.run.remote(
                message="What is the value of secret_number multiplied by 2?",
                tools=tools,
            )
        )
        logger.info(f"Agent response: {response4b['content']}")

        logger.info("\n" + "=" * 60)
        logger.info("Demo completed successfully!")
        logger.info("=" * 60)

    finally:
        # Cleanup code interpreter session
        logger.info("Cleaning up code interpreter session...")
        try:
            ray.get(cleanup_session.remote(code_session_id))
            logger.info("Code interpreter session cleaned up")
        except Exception as e:
            logger.warning(f"Failed to cleanup session: {e}")

        # Cleanup
        logger.info("Shutting down Ray...")
        ray.shutdown()


def simple_example():
    """Simple standalone example without an agent"""

    logger.info("\n" + "=" * 60)
    logger.info("Simple Code Execution Example (No Agent)")
    logger.info("=" * 60)

    # Initialize Ray
    ray.init(ignore_reinit_error=True, num_cpus=2)

    try:
        # Basic execution
        logger.info("\n1. Basic execution:")
        result = ray.get(execute_code.remote("print('Hello from Docker!')"))
        if result["status"] == "success":
            logger.info(f"Output: {result['stdout']}")
        else:
            logger.error(f"Error: {result['error']}")  # type: ignore[typeddict-item]

        # Session persistence
        logger.info("\n2. Session persistence:")
        session_id = "my-session"

        ray.get(execute_code.remote("x = [1, 2, 3, 4, 5]", session_id=session_id))  # type: ignore[call-arg]
        ray.get(execute_code.remote("y = sum(x)", session_id=session_id))  # type: ignore[call-arg]
        result = ray.get(
            execute_code.remote("print(f'Sum: {y}')", session_id=session_id)  # type: ignore[call-arg]
        )
        if result["status"] == "success":
            logger.info(f"Output: {result['stdout']}")
        else:
            logger.error(f"Error: {result['error']}")  # type: ignore[typeddict-item]

        # Package installation
        logger.info("\n3. Package installation:")
        ray.get(install_package.remote("requests", session_id=session_id))  # type: ignore[call-arg]
        result = ray.get(
            execute_code.remote(
                "import requests; print(f'Requests version: {requests.__version__}')",
                session_id=session_id,  # type: ignore[call-arg]
            )
        )
        if result["status"] == "success":
            logger.info(f"Output: {result['stdout']}")
        else:
            logger.error(f"Error: {result['error']}")  # type: ignore[typeddict-item]

        # Custom Dockerfile
        logger.info("\n4. Custom Dockerfile:")
        dockerfile = """
FROM python:3.12-slim
RUN pip install numpy
"""
        result = ray.get(
            execute_code.remote(  # type: ignore[call-arg]
                "import numpy as np; print(f'NumPy version: {np.__version__}')",
                dockerfile=dockerfile,
                session_id="custom-env",
            )
        )
        if result["status"] == "success":
            logger.info(f"Output: {result['stdout']}")
        else:
            logger.error(f"Error: {result['error']}")  # type: ignore[typeddict-item]

        logger.info("\nSimple example completed!")

    finally:
        ray.shutdown()


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--simple":
        simple_example()
    else:
        main()
