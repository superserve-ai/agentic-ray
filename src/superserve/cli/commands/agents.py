"""CLI commands for managing hosted agents."""

import json
import sys

import click
import questionary
from questionary import Style

from ..platform.client import PlatformAPIError, PlatformClient
from ..platform.types import DEFAULT_MODEL, AgentConfig

# Pastel prompt style
PROMPT_STYLE = Style(
    [
        ("qmark", "fg:#b48ead"),  # soft lavender question mark
        ("question", "fg:#d8dee9 bold"),  # light grey-white question text
        ("answer", "fg:#e8915a"),  # warm orange answers
        ("pointer", "fg:#b48ead bold"),  # lavender pointer
        ("highlighted", "fg:#88c0d0 bold"),  # pastel cyan for focused item
        ("selected", "fg:#e8915a"),  # warm orange for checked items
        ("instruction", "fg:#4c566a"),  # muted grey instructions
        ("disabled", "fg:#4c566a italic"),  # muted grey disabled
    ]
)

AVAILABLE_MODELS = [
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-6",
    "claude-haiku-4-5-20251001",
]

MODEL_DISPLAY_NAMES = {
    "claude-sonnet-4-5-20250929": "Sonnet 4.5",
    "claude-opus-4-6": "Opus 4.6",
    "claude-haiku-4-5-20251001": "Haiku 4.5",
}


def display_model(model_id: str) -> str:
    """Return friendly display name for a model, or the ID if unknown."""
    return MODEL_DISPLAY_NAMES.get(model_id, model_id)


def _abort_if_cancelled(value: object) -> None:
    """Exit if the user cancelled the prompt."""
    if value is None:
        click.echo("Cancelled.", err=True)
        sys.exit(1)


AVAILABLE_TOOLS = ["Bash", "Read", "Write", "Glob", "Grep", "WebSearch", "WebFetch"]

DEFAULT_TOOLS = ["Bash", "Read", "Write", "Glob", "Grep"]


@click.group()
def agents():
    """Manage hosted agents."""
    pass


@agents.command("list")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def list_agents(as_json: bool):
    """List all hosted agents."""
    client = PlatformClient()

    try:
        agent_list = client.list_agents()
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if as_json:
        click.echo(json.dumps([a.model_dump() for a in agent_list], indent=2))
        return

    if not agent_list:
        click.echo(
            "No agents found. Create one with: superserve agents create --name <name>"
        )
        return

    # Print table header
    click.echo(f"{'NAME':<25} {'MODEL':<30} {'CREATED':<20}")
    click.echo("-" * 75)

    for agent in agent_list:
        created = agent.created_at[:10] if agent.created_at else ""
        model_short = display_model(agent.model)
        click.echo(f"{agent.name:<25} {model_short:<30} {created:<20}")


@agents.command("create")
@click.option(
    "--name", default=None, help="Agent name (lowercase, alphanumeric, hyphens)"
)
@click.option("--model", default=None, help="Model to use")
@click.option(
    "--system-prompt",
    default=None,
    help="System prompt (or @file.txt to read from file)",
)
@click.option("--tools", default=None, help="Comma-separated list of tools")
@click.option("--max-turns", default=None, type=int, help="Maximum conversation turns")
@click.option("--timeout", default=None, type=int, help="Timeout in seconds")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def create_agent(
    name: str | None,
    model: str | None,
    system_prompt: str | None,
    tools: str | None,
    max_turns: int | None,
    timeout: int | None,
    as_json: bool,
):
    """Create a new hosted agent."""
    interactive = sys.stdin.isatty() and not as_json

    # --- Name ---
    if name is None:
        if not interactive:
            click.echo("Error: --name is required", err=True)
            sys.exit(1)
        name = questionary.text("Agent name:", style=PROMPT_STYLE).ask()
        _abort_if_cancelled(name)

    # --- Model ---
    if model is None:
        if interactive:
            model_choices = [
                questionary.Choice(
                    "Sonnet 4.5 (Recommended)", value="claude-sonnet-4-5-20250929"
                ),
                questionary.Choice("Opus 4.6", value="claude-opus-4-6"),
                questionary.Choice("Haiku 4.5", value="claude-haiku-4-5-20251001"),
                questionary.Choice("Enter custom model name or ID", value="_custom"),
            ]
            model = questionary.select(
                "Select model:", choices=model_choices, style=PROMPT_STYLE
            ).ask()
            _abort_if_cancelled(model)
            if model == "_custom":
                model = questionary.text(
                    "Custom model name or ID:", style=PROMPT_STYLE
                ).ask()
                _abort_if_cancelled(model)
        else:
            model = DEFAULT_MODEL

    # --- System prompt ---
    if system_prompt is None:
        if interactive:
            from prompt_toolkit.formatted_text import HTML

            system_prompt = questionary.text(
                "System prompt:",
                style=PROMPT_STYLE,
                placeholder=HTML(
                    "<style bg='' fg='ansibrightblack'>You are a helpful assistant.</style>"
                ),
            ).ask()
            _abort_if_cancelled(system_prompt)
            if not system_prompt:
                system_prompt = "You are a helpful assistant."
        else:
            system_prompt = "You are a helpful assistant."

    # Handle @file.txt syntax for system prompt
    if system_prompt.startswith("@"):
        file_path = system_prompt[1:]
        try:
            with open(file_path) as f:
                system_prompt = f.read()
        except FileNotFoundError:
            click.echo(f"Error: File not found: {file_path}", err=True)
            sys.exit(1)

    # --- Tools ---
    if tools is not None:
        tool_list = [t.strip() for t in tools.split(",") if t.strip()]
    elif interactive:
        tool_choices = [
            questionary.Choice(t, checked=(t in DEFAULT_TOOLS)) for t in AVAILABLE_TOOLS
        ]
        tool_list = questionary.checkbox(
            "Select tools:", choices=tool_choices, style=PROMPT_STYLE
        ).ask()
        _abort_if_cancelled(tool_list)
    else:
        tool_list = list(DEFAULT_TOOLS)

    # --- Max turns ---
    if max_turns is None:
        if interactive:
            answer = questionary.text(
                "Max turns:", default="10", style=PROMPT_STYLE
            ).ask()
            _abort_if_cancelled(answer)
            max_turns = int(answer)
        else:
            max_turns = 10

    # --- Timeout ---
    if timeout is None:
        if interactive:
            answer = questionary.text(
                "Timeout in seconds:", default="300", style=PROMPT_STYLE
            ).ask()
            _abort_if_cancelled(answer)
            timeout = int(answer)
        else:
            timeout = 300

    config = AgentConfig(
        name=name,
        model=model,
        system_prompt=system_prompt,
        tools=tool_list,
        max_turns=max_turns,
        timeout_seconds=timeout,
    )

    client = PlatformClient()

    try:
        agent = client.create_agent(config)
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 409:
            click.echo(f"Error: Agent '{name}' already exists", err=True)
        elif e.status_code == 422:
            click.echo(f"Validation error: {e.message}", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if as_json:
        click.echo(json.dumps(agent.model_dump(), indent=2))
    else:
        click.echo(f"\nCreated agent '{agent.name}'")
        click.echo(f"  Model:   {display_model(agent.model)}")
        click.echo(f"  Tools:   {', '.join(agent.tools)}")
        click.echo(f"  Timeout: {agent.timeout_seconds}s")
        click.echo()
        click.echo(f'Run it with: superserve run {agent.name} "your prompt here"')


@agents.command("get")
@click.argument("name")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def get_agent(name: str, as_json: bool):
    """Get details of a hosted agent."""
    client = PlatformClient()

    try:
        agent = client.get_agent(name)
    except PlatformAPIError as e:
        if e.status_code == 404:
            click.echo(f"Agent '{name}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if as_json:
        click.echo(json.dumps(agent.model_dump(), indent=2))
        return

    click.echo(f"ID:            {agent.id}")
    click.echo(f"Name:          {agent.name}")
    click.echo(f"Model:         {display_model(agent.model)}")
    click.echo(f"Max Turns:     {agent.max_turns}")
    click.echo(f"Timeout:       {agent.timeout_seconds}s")
    click.echo(f"Tools:         {', '.join(agent.tools)}")
    click.echo(f"Created:       {agent.created_at}")
    if agent.system_prompt:
        prompt_preview = agent.system_prompt[:100]
        if len(agent.system_prompt) > 100:
            prompt_preview += "..."
        click.echo(f"System Prompt: {prompt_preview}")


@agents.command("delete")
@click.argument("name")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
def delete_agent(name: str, yes: bool):
    """Delete a hosted agent."""
    if not yes:
        if not click.confirm(f"Delete agent '{name}'?"):
            click.echo("Cancelled")
            return

    client = PlatformClient()

    try:
        client.delete_agent(name)
    except PlatformAPIError as e:
        if e.status_code == 404:
            click.echo(f"Agent '{name}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    click.echo(f"Deleted agent '{name}'")
