"""Synthetic data generator agent that writes and executes code to generate datasets."""

from pydantic_ai import Agent

import superserve
from superserve.sandbox import Sandbox

# Create sandbox - works in both Docker and Kubernetes modes
# Packages are installed at runtime via pip
sandbox = Sandbox(timeout=120)

# Pre-warm the sandbox to reduce cold start latency
# This creates the executor actor and claims a K8s sandbox ahead of time
# Skip during discovery mode (rayai deploy) to avoid starting Ray locally
if not superserve.is_discovery_mode():
    sandbox.prewarm()

SYSTEM_PROMPT = """You are a synthetic data generator agent. Your job is to generate realistic synthetic datasets based on user requirements.

You have access to a Python sandbox. Before generating data, you MUST first install required packages.

When generating data:
1. First, install required packages: run `pip install pandas numpy faker scikit-learn` (only once per session)
2. Understand the user's requirements (columns, data types, relationships, constraints)
3. Write Python code to generate the synthetic data using appropriate libraries
4. Save the generated dataset to /tmp/output.csv (or other formats as requested)
5. Print a summary of the generated data (shape, columns, sample rows)

Tips:
- Use faker for realistic names, addresses, emails, etc.
- Use numpy for numerical distributions
- Use pandas for data manipulation and export
- Consider correlations between columns when relevant
- Add realistic noise and variation to make data look authentic

Always save the final dataset to a file in /tmp/ and confirm the file was created."""


def make_agent():
    """Create and configure the synthetic data generator agent."""
    return Agent(
        "openai:gpt-4o",
        system_prompt=SYSTEM_PROMPT,
        tools=[sandbox.run_code, sandbox.bash],
    )


# Serve the agent
superserve.serve(make_agent, name="datagen", num_cpus=1, memory="2GB")
