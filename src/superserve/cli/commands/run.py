"""CLI command for running agents."""

import json
import signal
import sys

import click

from ..platform.client import PlatformAPIError, PlatformClient
from ..utils import Spinner, format_duration, sanitize_terminal_output


def _stream_events(event_iter, as_json: bool, spinner: Spinner | None = None) -> int:
    """Stream SSE events to terminal. Returns 0 on success, non-zero on failure."""
    for event in event_iter:
        if as_json:
            click.echo(json.dumps({"type": event.type, "data": event.data}))
            if event.type == "run.completed":
                return 0
            if event.type == "run.failed":
                return 1
            if event.type == "run.cancelled":
                return 130
            continue

        if event.type in ("status", "run.started", "heartbeat"):
            pass  # Spinner is already running

        elif event.type == "message.delta":
            if spinner:
                spinner.stop()
            content = event.data.get("content", "")
            click.echo(sanitize_terminal_output(content), nl=False)

        elif event.type == "tool.start":
            if spinner:
                spinner.stop()
            tool = event.data.get("tool", "unknown")
            tool_input = event.data.get("input", {})
            input_str = sanitize_terminal_output(str(tool_input))
            input_preview = input_str[:50]
            if len(input_str) > 50:
                input_preview += "..."
            click.echo(f"\n[{tool}] {input_preview}", nl=False, err=True)

        elif event.type == "tool.end":
            duration = event.data.get("duration_ms", 0)
            click.echo(f" ({format_duration(duration)})", err=True)
            if spinner:
                spinner.start()

        elif event.type == "run.completed":
            if spinner:
                spinner.stop()
            duration = event.data.get("duration_ms", 0)
            click.echo()  # Newline after content
            click.echo(
                f"\nCompleted in {format_duration(duration)}",
                err=True,
            )
            if event.data.get("max_turns_reached"):
                msg = sanitize_terminal_output(
                    event.data.get("max_turns_message", "Max turns reached.")
                )
                click.echo(f"\nWarning: {msg}", err=True)
            return 0

        elif event.type == "run.failed":
            if spinner:
                spinner.stop()
            error = event.data.get("error", {})
            message = sanitize_terminal_output(error.get("message", "Unknown error"))
            click.echo(f"\nError: {message}", err=True)
            return 1

        elif event.type == "run.cancelled":
            if spinner:
                spinner.stop()
            click.echo("\nRun was cancelled.", err=True)
            return 130

    if spinner:
        spinner.stop()
    click.echo("\nWarning: Stream ended unexpectedly.", err=True)
    return 1


@click.command("run")
@click.argument("agent")
@click.argument("prompt", required=False, default=None)
@click.option(
    "--single", is_flag=True, help="Exit after a single response (no interactive loop)"
)
@click.option("--json", "as_json", is_flag=True, help="Output raw JSON events")
def run_agent(agent: str, prompt: str | None, single: bool, as_json: bool):
    """Run a hosted agent interactively.

    AGENT is the agent name or ID.
    PROMPT is an optional initial prompt. If omitted, starts interactive mode immediately.

    The conversation continues until you press Ctrl+C or submit an empty line.

    Examples:
        superserve run my-agent
        superserve run my-agent "What is 2+2?"
        superserve run my-agent "Hello" --single
    """
    client = PlatformClient()
    spinner: Spinner | None = None

    def handle_interrupt(signum, frame):
        if spinner:
            spinner.stop()
        click.echo("\nCancelled.", err=True)
        sys.exit(130)

    signal.signal(signal.SIGINT, handle_interrupt)

    if not prompt:
        try:
            prompt = click.prompt("You", prompt_suffix="> ")
        except (EOFError, click.Abort):
            return
        if not prompt.strip():
            return

    interactive = not single and not as_json and sys.stdin.isatty()
    use_spinner = not as_json and sys.stderr.isatty()

    # Pre-flight: check required secrets are set
    try:
        agent_info = client.get_agent(agent)
        if agent_info.required_secrets:
            missing = [
                s
                for s in agent_info.required_secrets
                if s not in agent_info.environment_keys
            ]
            if missing:
                click.echo(
                    f"Error: Missing required secret(s): {', '.join(missing)}",
                    err=True,
                )
                click.echo(
                    f"Set them with: superserve secrets set {agent_info.name} "
                    + " ".join(f"{k}=..." for k in missing),
                    err=True,
                )
                sys.exit(1)
    except PlatformAPIError:
        pass  # Let the session creation handle auth/404 errors

    try:
        if use_spinner:
            spinner = Spinner(show_elapsed=True)
            spinner.start()
        session_data = client.create_session(agent)
        session_id = session_data["id"]

        exit_code = _stream_events(
            client.stream_session_message(session_id, prompt),
            as_json,
            spinner,
        )
        if exit_code:
            sys.exit(exit_code)

        if not interactive:
            return

        # Interactive loop for multi-turn conversation
        while True:
            try:
                next_prompt = click.prompt("\nYou", prompt_suffix="> ")
            except (EOFError, click.Abort):
                click.echo()
                break
            if not next_prompt.strip() or next_prompt.strip().lower() == "exit":
                break

            if spinner:
                spinner.start()

            exit_code = _stream_events(
                client.stream_session_message(session_id, next_prompt),
                as_json,
                spinner,
            )
            if exit_code:
                sys.exit(exit_code)

    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 404:
            click.echo(f"Agent '{agent}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)
    finally:
        if spinner:
            spinner.stop()
