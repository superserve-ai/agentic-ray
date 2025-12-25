"""Agno demo agent using Ray-distributed tools."""

import os
import sys
from pathlib import Path

from agno.agent import Agent as AgnoAgent
from dotenv import load_dotenv

from rayai import agent
from rayai.adapters import AgentFramework, RayToolWrapper

from .tools import add, echo

# Load .env from example directory
load_dotenv(Path(__file__).parent.parent.parent / ".env")

# Validate required API keys at startup
REQUIRED_KEYS = ["OPENAI_API_KEY"]
missing = [k for k in REQUIRED_KEYS if not os.environ.get(k)]
if missing:
    sys.exit(f"Missing required environment variables: {', '.join(missing)}")


SYSTEM_PROMPT = """You are a helpful assistant.
You can call tools to echo messages and add numbers.
Keep responses short and clear.
"""


@agent(num_cpus=1, memory="512MB")
class AgnoDemoAgent:
    """Demo agent that uses Agno with Ray tools."""

    def __init__(self) -> None:
        # Ray tools
        self.tools = [echo, add]

        # Wrap Ray tools for Agno compatibility
        wrapper = RayToolWrapper(framework=AgentFramework.AGNO)
        agno_tools = wrapper.wrap_tools(self.tools)

        # Create Agno agent (requires OPENAI_API_KEY env var)
        self.agno_agent = AgnoAgent(
            model="openai:gpt-4o",
            tools=agno_tools,
        )

    def run(self, data: dict) -> dict:
        """Execute the Agno agent.

        Args:
            data: OpenAI Chat API format with a "messages" list.

        Returns:
            Dict with 'response' containing the agent output.
        """
        messages = data.get("messages", [])
        if not messages:
            return {"error": "No messages provided"}

        # Use the last user message as the current prompt
        user_message = None
        for msg in reversed(messages):
            if msg.get("role") == "user":
                user_message = msg.get("content", "")
                break

        if not user_message:
            return {"error": "No user message found"}

        prompt = f"{SYSTEM_PROMPT}\n\nUser: {user_message}"
        result = self.agno_agent.run(prompt)
        return {"response": result.content}
