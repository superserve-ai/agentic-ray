"""Weather agent using Pydantic AI with batch_tool for parallel execution."""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pydantic_ai import Agent

import rayai

load_dotenv(Path(__file__).parent.parent.parent / ".env")

REQUIRED_KEYS = ["OPENAI_API_KEY", "WEATHER_API_KEY"]
missing = [k for k in REQUIRED_KEYS if not os.environ.get(k)]
if missing:
    sys.exit(f"Missing required environment variables: {', '.join(missing)}")

from .tools import batch_weather  # noqa: E402

SYSTEM_PROMPT = """\
You are a helpful weather assistant.

When users ask about weather in one or more cities, use the batch tool to fetch
weather data for all cities in parallel. This is much faster than fetching them
one at a time.

To use the batch tool, call it with:
- tool_name: "get_weather"
- tool_inputs: a list of dicts, each with a "city" key

Example: To get weather for NYC, London, and Tokyo:
tool_name="get_weather"
tool_inputs=[{"city": "New York"}, {"city": "London"}, {"city": "Tokyo"}]

After receiving the weather data, provide a friendly summary to the user.
"""


def make_agent():
    """Create and configure the Pydantic AI weather agent."""
    return Agent(
        "openai:gpt-4o-mini",
        system_prompt=SYSTEM_PROMPT,
        tools=[batch_weather],
    )


# Serve the agent with Ray Serve
rayai.serve(make_agent, name="weather", num_cpus=1, memory="1GB")
