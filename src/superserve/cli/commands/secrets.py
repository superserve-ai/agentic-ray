"""CLI commands for managing agent secrets."""

import sys

import click

from ..platform.client import PlatformAPIError, PlatformClient


@click.group()
def secrets():
    """Manage agent secrets and environment variables.

    Secrets are stored encrypted and injected into agent sandboxes at runtime.
    Use these commands to manage API keys and other sensitive configuration.

    Examples:

        # Set a secret for an agent
        superserve secrets set my-agent ANTHROPIC_API_KEY=sk-ant-xxx

        # Set multiple secrets
        superserve secrets set my-agent KEY1=val1 KEY2=val2

        # List secret keys (values are never shown)
        superserve secrets list my-agent

        # Delete a secret
        superserve secrets delete my-agent ANTHROPIC_API_KEY
    """
    pass


@secrets.command("set")
@click.argument("agent_name")
@click.argument("key_values", nargs=-1, required=True)
def set_secrets(agent_name: str, key_values: tuple[str, ...]):
    """Set secrets for an agent.

    Secrets are merged with existing secrets. To replace a secret,
    simply set it again with the new value.

    Arguments:

        AGENT_NAME: Name of the agent

        KEY_VALUES: One or more KEY=VALUE pairs

    Examples:

        superserve secrets set my-agent ANTHROPIC_API_KEY=sk-ant-xxx

        superserve secrets set my-agent KEY1=val1 KEY2=val2
    """
    # Parse KEY=VALUE pairs
    env_vars: dict[str, str] = {}
    for kv in key_values:
        if "=" not in kv:
            click.echo(f"Error: Invalid format '{kv}'. Use KEY=VALUE", err=True)
            sys.exit(1)
        key, value = kv.split("=", 1)
        if not key:
            click.echo(f"Error: Empty key in '{kv}'", err=True)
            sys.exit(1)
        env_vars[key] = value

    client = PlatformClient()

    try:
        keys = client.set_agent_secrets(agent_name, env_vars)
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 404:
            click.echo(f"Agent '{agent_name}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    click.echo(f"Set {len(env_vars)} secret(s) for agent '{agent_name}'")
    if keys:
        click.echo(f"Current secrets: {', '.join(keys)}")


@secrets.command("list")
@click.argument("agent_name")
def list_secrets(agent_name: str):
    """List secret keys for an agent.

    Only key names are shown - values are never exposed.

    Arguments:

        AGENT_NAME: Name of the agent
    """
    client = PlatformClient()

    try:
        keys = client.get_agent_secrets(agent_name)
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 404:
            click.echo(f"Agent '{agent_name}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if not keys:
        click.echo(f"No secrets configured for agent '{agent_name}'")
        click.echo("Set secrets with: superserve secrets set my-agent KEY=VALUE")
        return

    click.echo(f"Secrets for agent '{agent_name}':")
    for key in keys:
        click.echo(f"  - {key}")


@secrets.command("delete")
@click.argument("agent_name")
@click.argument("key")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
def delete_secret(agent_name: str, key: str, yes: bool):
    """Delete a secret from an agent.

    Arguments:

        AGENT_NAME: Name of the agent

        KEY: Name of the secret to delete
    """
    if not yes:
        if not click.confirm(f"Delete secret '{key}' from agent '{agent_name}'?"):
            click.echo("Cancelled")
            return

    client = PlatformClient()

    try:
        keys = client.delete_agent_secret(agent_name, key)
    except PlatformAPIError as e:
        if e.status_code == 401:
            click.echo("Not authenticated. Run 'superserve login' first.", err=True)
        elif e.status_code == 404:
            if "secret" in e.message.lower():
                click.echo(
                    f"Secret '{key}' not found on agent '{agent_name}'", err=True
                )
            else:
                click.echo(f"Agent '{agent_name}' not found", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    click.echo(f"Deleted secret '{key}' from agent '{agent_name}'")
    if keys:
        click.echo(f"Remaining secrets: {', '.join(keys)}")
