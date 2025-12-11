"""Create new agents within a project."""

import shutil
from pathlib import Path

import click

SUPPORTED_FRAMEWORKS = ["python", "langchain", "pydantic"]


@click.command(name="create-agent")
@click.argument("agent_name")
@click.option(
    "--framework",
    type=click.Choice(SUPPORTED_FRAMEWORKS),
    default="python",
    help="Framework to use for the agent (default: python)",
)
def create_agent(agent_name: str, framework: str):
    """Create a new agent with the specified name."""
    agents_dir = Path.cwd() / "agents"

    if not agents_dir.exists():
        click.echo("Error: Not in a rayai project directory.")
        click.echo("Run 'rayai init <project_name>' to create a new project first.")
        return

    if not agent_name.isidentifier():
        click.echo(f"Error: '{agent_name}' is not a valid Python identifier")
        return

    agent_dir = agents_dir / agent_name
    if agent_dir.exists():
        click.echo(f"Error: Agent '{agent_name}' already exists")
        return

    try:
        agent_dir.mkdir()
        _create_agent_files(agent_dir, agent_name, framework)

        click.echo(f"Created {framework} agent: {agent_name}")
        click.echo(f"Location: {agent_dir}")
        click.echo("\nNext steps:")
        click.echo(f"  Edit agents/{agent_name}/agent.py to implement your logic")
        click.echo("  Run with: rayai serve")
        click.echo(f"  Test at: POST http://localhost:8000/agents/{agent_name}/chat")

    except Exception as e:
        click.echo(f"Error: Failed to create agent: {e}")
        if agent_dir.exists():
            shutil.rmtree(agent_dir)


def _create_agent_files(agent_dir: Path, agent_name: str, framework: str):
    """Create the agent files with framework-specific templates."""
    (agent_dir / "__init__.py").write_text(f'"""Agent package for {agent_name}."""')

    if framework == "python":
        content = _get_python_template(agent_name)
    elif framework == "langchain":
        content = _get_langchain_template(agent_name)
    elif framework == "pydantic":
        content = _get_pydantic_template(agent_name)
    else:
        content = _get_python_template(agent_name)

    (agent_dir / "agent.py").write_text(content)


def _get_python_template(agent_name: str) -> str:
    """Get pure Python agent template."""
    return f'''"""Pure Python agent implementation for {agent_name}."""

from ray_agents import agent, tool, execute_tools


# Define tools with resource requirements
@tool(desc="Example tool - replace with your own", num_cpus=1)
def example_tool(query: str) -> str:
    """Process a query and return a result."""
    return f"Processed: {{query}}"


@agent(num_cpus=1, memory="2GB")
class {agent_name.title().replace("_", "")}:
    """Agent implementation using pure Python."""

    def __init__(self):
        # Store tools for this agent
        self.tools = [example_tool]

    def run(self, data: dict) -> dict:
        """Execute the agent.

        Args:
            data: OpenAI Chat API format:
                {{"messages": [
                    {{"role": "system", "content": "..."}},
                    {{"role": "user", "content": "..."}},
                    {{"role": "assistant", "content": "..."}},
                    ...
                ]}}

        Returns:
            Dict with 'response' key containing agent output
        """
        messages = data.get("messages", [])
        if not messages:
            return {{"error": "No messages provided"}}

        # Get the last user message
        user_message = None
        for msg in reversed(messages):
            if msg.get("role") == "user":
                user_message = msg.get("content", "")
                break

        if not user_message:
            return {{"error": "No user message found"}}

        # Example: Execute tools (can be parallel or sequential)
        # results = execute_tools([(example_tool, {{"query": user_message}})], parallel=False)

        # Your implementation here:
        # - Use messages for full conversation context
        # - Parse the user message
        # - Decide which tools to call
        # - Execute tools and aggregate results
        # - Return response

        return {{
            "response": f"Received: {{user_message}}",
            "status": "success"
        }}
'''


def _get_langchain_template(agent_name: str) -> str:
    """Get LangChain agent template."""
    return f'''"""LangChain agent implementation for {agent_name}."""

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from ray_agents import agent, tool
from ray_agents.adapters import AgentFramework, ToolAdapter


# Define tools with resource requirements
@tool(desc="Example tool - replace with your own", num_cpus=1)
def example_tool(query: str) -> str:
    """Process a query and return a result."""
    return f"Processed: {{query}}"


@agent(num_cpus=1, memory="2GB")
class {agent_name.title().replace("_", "")}:
    """Agent implementation using LangChain/LangGraph."""

    def __init__(self):
        # Store Ray tools
        self.tools = [example_tool]

        # Set up LLM (requires OPENAI_API_KEY env var)
        self.llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

        # Wrap Ray tools for LangChain compatibility
        adapter = ToolAdapter(framework=AgentFramework.LANGCHAIN)
        lc_tools = adapter.wrap_tools(self.tools)

        # Create LangChain ReAct agent
        self.lc_agent = create_react_agent(self.llm, lc_tools)

    async def run(self, data: dict) -> dict:
        """Execute the LangChain agent.

        Args:
            data: OpenAI Chat API format:
                {{"messages": [
                    {{"role": "system", "content": "..."}},
                    {{"role": "user", "content": "..."}},
                    {{"role": "assistant", "content": "..."}},
                    ...
                ]}}

        Returns:
            Dict with 'response' key containing agent output
        """
        messages = data.get("messages", [])
        if not messages:
            return {{"error": "No messages provided"}}

        # Convert OpenAI format to LangChain tuples
        lc_messages = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            # LangChain uses "human" instead of "user", "ai" instead of "assistant"
            if role == "user":
                lc_messages.append(("user", content))
            elif role == "assistant":
                lc_messages.append(("assistant", content))
            elif role == "system":
                lc_messages.append(("system", content))

        # Run the agent
        result = await self.lc_agent.ainvoke({{"messages": lc_messages}})

        # Extract the final response
        agent_messages = result.get("messages", [])
        if agent_messages:
            response = agent_messages[-1].content
        else:
            response = "No response generated"

        return {{"response": response}}
'''


def _get_pydantic_template(agent_name: str) -> str:
    """Get Pydantic AI agent template."""
    return f'''"""Pydantic AI agent implementation for {agent_name}."""

from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, UserPromptPart

from ray_agents import agent, tool
from ray_agents.adapters import AgentFramework, ToolAdapter


# Define tools with resource requirements
@tool(desc="Example tool - replace with your own", num_cpus=1)
def example_tool(query: str) -> str:
    """Process a query and return a result."""
    return f"Processed: {{query}}"


@agent(num_cpus=1, memory="2GB")
class {agent_name.title().replace("_", "")}:
    """Agent implementation using Pydantic AI."""

    def __init__(self):
        # Store Ray tools
        self.tools = [example_tool]

        # Wrap Ray tools for Pydantic AI compatibility
        adapter = ToolAdapter(framework=AgentFramework.PYDANTIC)
        pydantic_tools = adapter.wrap_tools(self.tools)

        # Create Pydantic AI agent (requires OPENAI_API_KEY env var)
        self.pydantic_agent = Agent(
            "openai:gpt-4o-mini",
            system_prompt="You are a helpful assistant.",
            tools=pydantic_tools,
        )

    def _convert_to_pydantic_history(self, messages: list[dict]) -> list[ModelMessage]:
        """Convert OpenAI format messages to Pydantic AI format."""
        history: list[ModelMessage] = []
        for msg in messages[:-1]:  # Exclude last message (will be current prompt)
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "user":
                history.append(ModelRequest(parts=[UserPromptPart(content=content)]))
            elif role == "assistant":
                history.append(ModelResponse(parts=[TextPart(content=content)]))
        return history

    async def run(self, data: dict) -> dict:
        """Execute the Pydantic AI agent.

        Args:
            data: OpenAI Chat API format:
                {{"messages": [
                    {{"role": "system", "content": "..."}},
                    {{"role": "user", "content": "..."}},
                    {{"role": "assistant", "content": "..."}},
                    ...
                ]}}

        Returns:
            Dict with 'response' key containing agent output
        """
        messages = data.get("messages", [])
        if not messages:
            return {{"error": "No messages provided"}}

        # Get the last user message as the current prompt
        current_message = None
        for msg in reversed(messages):
            if msg.get("role") == "user":
                current_message = msg.get("content", "")
                break

        if not current_message:
            return {{"error": "No user message found"}}

        # Convert history (all messages except last user message)
        message_history = self._convert_to_pydantic_history(messages)

        # Run the agent
        result = await self.pydantic_agent.run(current_message, message_history=message_history)

        return {{"response": result.output}}
'''
