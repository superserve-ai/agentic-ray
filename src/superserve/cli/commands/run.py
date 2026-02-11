"""CLI command for running agents."""

import json
import signal
import sys

import click

from ..platform.client import PlatformAPIError, PlatformClient
from ..utils import echo_truncated, format_duration, sanitize_terminal_output


@click.command("run")
@click.argument("agent")
@click.argument("prompt")
@click.option("--session", help="Session ID for multi-turn conversations")
@click.option("--json", "as_json", is_flag=True, help="Output raw JSON events")
def run_agent(agent: str, prompt: str, session: str | None, as_json: bool):
    """Run a hosted agent with a prompt.

    AGENT is the agent name or ID.
    PROMPT is the text prompt to send to the agent.

    Examples:
        superserve run my-agent "What is 2+2?"
        superserve run research-bot "Summarize the latest AI news" --session sess-123
    """
    client = PlatformClient()
    cancelled = False

    def handle_interrupt(signum, frame):
        nonlocal cancelled
        run_id = getattr(client, "_current_stream_run_id", None)
        if run_id and not cancelled:
            cancelled = True
            click.echo("\nCancelling run...", err=True)
            try:
                client.cancel_run(run_id)
                click.echo("Run cancelled.", err=True)
            except PlatformAPIError:
                pass
        sys.exit(130)

    signal.signal(signal.SIGINT, handle_interrupt)

    try:
        # Create and stream run in a single request for real-time output
        for event in client.create_and_stream_run(agent, prompt, session):
            if as_json:
                click.echo(json.dumps({"type": event.type, "data": event.data}))
                continue

            if event.type == "run.started":
                # Silent start
                pass

            elif event.type == "message.delta":
                content = event.data.get("content", "")
                # Sanitize LLM output to prevent terminal injection via ANSI sequences
                click.echo(sanitize_terminal_output(content), nl=False)

            elif event.type == "tool.start":
                tool = event.data.get("tool", "unknown")
                tool_input = event.data.get("input", {})
                # Show tool usage in dim text
                # Sanitize tool input as it may contain LLM-controlled content
                input_str = sanitize_terminal_output(str(tool_input))
                input_preview = input_str[:50]
                if len(input_str) > 50:
                    input_preview += "..."
                click.echo(f"\n[{tool}] {input_preview}", nl=False, err=True)

            elif event.type == "tool.end":
                tool = event.data.get("tool", "unknown")
                duration = event.data.get("duration_ms", 0)
                click.echo(f" ({format_duration(duration)})", err=True)

            elif event.type == "run.completed":
                usage = event.data.get("usage", {})
                duration = event.data.get("duration_ms", 0)
                input_tokens = usage.get("input_tokens", 0)
                output_tokens = usage.get("output_tokens", 0)
                click.echo()  # Newline after content
                click.echo(
                    f"\nCompleted in {format_duration(duration)} "
                    f"({input_tokens:,} input / {output_tokens:,} output tokens)",
                    err=True,
                )

            elif event.type == "run.failed":
                error = event.data.get("error", {})
                message = error.get("message", "Unknown error")
                click.echo(f"\nError: {message}", err=True)
                sys.exit(1)

            elif event.type == "run.cancelled":
                click.echo("\nRun was cancelled.", err=True)
                sys.exit(130)

    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 404:
            click.echo(f"Agent '{agent}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)


@click.group("runs")
def runs():
    """View and manage runs."""
    pass


@runs.command("list")
@click.option("--agent", help="Filter by agent name or ID")
@click.option(
    "--status",
    type=click.Choice(["pending", "running", "completed", "failed", "cancelled"]),
)
@click.option("--limit", default=20, type=int, help="Maximum number of runs to show")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def list_runs(agent: str | None, status: str | None, limit: int, as_json: bool):
    """List recent runs."""
    client = PlatformClient()

    try:
        run_list = client.list_runs(agent_id=agent, status=status, limit=limit)
    except PlatformAPIError as e:
        click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if as_json:
        click.echo(json.dumps([r.model_dump() for r in run_list], indent=2))
        return

    if not run_list:
        click.echo("No runs found.")
        return

    click.echo(
        f"{'ID':<20} {'AGENT':<20} {'STATUS':<12} {'DURATION':<10} {'CREATED':<20}"
    )
    click.echo("-" * 82)

    for run in run_list:
        run_id_short = run.id[-12:] if len(run.id) > 12 else run.id
        agent_short = run.agent_id[-12:] if len(run.agent_id) > 12 else run.agent_id
        duration = format_duration(run.duration_ms) if run.duration_ms else "-"
        created = run.created_at[:16] if run.created_at else ""
        click.echo(
            f"{run_id_short:<20} {agent_short:<20} {run.status:<12} {duration:<10} {created:<20}"
        )


@runs.command("get")
@click.argument("run_id")
@click.option("--full", is_flag=True, help="Show full output without truncation")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def get_run(run_id: str, full: bool, as_json: bool):
    """Get details of a run."""
    client = PlatformClient()

    try:
        run = client.get_run(run_id)
    except PlatformAPIError as e:
        if e.status_code == 404:
            click.echo(f"Run '{run_id}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if as_json:
        click.echo(json.dumps(run.model_dump(), indent=2))
        return

    click.echo(f"ID:       {run.id}")
    click.echo(f"Agent:    {run.agent_id}")
    click.echo(f"Status:   {run.status}")
    click.echo(f"Created:  {run.created_at}")

    if run.started_at:
        click.echo(f"Started:  {run.started_at}")
    if run.completed_at:
        click.echo(f"Completed: {run.completed_at}")

    if run.duration_ms:
        click.echo(f"Duration: {format_duration(run.duration_ms)}")

    if run.usage:
        click.echo(
            f"Tokens:   {run.usage.input_tokens:,} input / {run.usage.output_tokens:,} output"
        )

    if run.tools_used:
        click.echo(f"Tools:    {', '.join(run.tools_used)}")

    echo_truncated(run.prompt, "Prompt", 500, full)

    if run.output:
        echo_truncated(run.output, "Output", 1000, full)

    if run.error_message:
        click.echo()
        click.echo(f"Error: {run.error_message}")
