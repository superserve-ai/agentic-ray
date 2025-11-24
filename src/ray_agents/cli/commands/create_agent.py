"""Create new agents within a project."""

import shutil
from pathlib import Path

import click


@click.command(name="create-agent")
@click.argument("agent_name")
def create_agent(agent_name: str):
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
        _create_agent_files(agent_dir, agent_name)

        click.echo(f"Created agent: {agent_name}")
        click.echo(f"Location: {agent_dir}")
        click.echo("\nNext steps:")
        click.echo(f"  Edit agents/{agent_name}/agent.py to implement your logic")
        click.echo("  Deploy with: rayai serve")
        click.echo(f"  Test at: POST http://localhost:8000/agents/{agent_name}/chat")

    except Exception as e:
        click.echo(f"Error: Failed to create agent: {e}")
        if agent_dir.exists():
            shutil.rmtree(agent_dir)


def _create_agent_files(agent_dir: Path, agent_name: str):
    """Create the agent files with templates."""
    (agent_dir / "__init__.py").write_text(f'"""Agent package for {agent_name}."""')

    agent_content = f'''"""Agent implementation for {agent_name}."""

from ray_agents import RayAgent


class {agent_name.title()}(RayAgent):

    def __init__(self):
        super().__init__()

    def run(self, data: dict) -> dict:
        """Main entry point for all agent requests.

        Called for every request to /agents/{agent_name}/chat
        Implement your agent logic here or route to other methods.
        """
        return {{
            "error": "AGENT_NOT_IMPLEMENTED",
            "message": "This agent is not yet implemented. Please add your logic to the run() method.",
            "status": "error"
        }}
'''
    (agent_dir / "agent.py").write_text(agent_content)
