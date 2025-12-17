"""Analytics configuration commands."""

import click

from ..analytics import ANALYTICS_DISABLED_FILE, RAYAI_CONFIG_DIR


@click.group()
def analytics():
    """Manage anonymous usage analytics."""
    pass


@analytics.command(name="on")
def analytics_on():
    """Enable anonymous usage analytics."""
    if ANALYTICS_DISABLED_FILE.exists():
        ANALYTICS_DISABLED_FILE.unlink()
    click.echo("Analytics enabled. Thank you for helping improve RayAI!")


@analytics.command(name="off")
def analytics_off():
    """Disable anonymous usage analytics."""
    RAYAI_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    ANALYTICS_DISABLED_FILE.touch()
    click.echo("Analytics disabled. No data will be collected.")


@analytics.command(name="status")
def analytics_status():
    """Check current analytics status."""
    if ANALYTICS_DISABLED_FILE.exists():
        click.echo("Analytics: disabled")
        click.echo("Run 'rayai analytics on' to enable.")
    else:
        click.echo("Analytics: enabled")
        click.echo("Run 'rayai analytics off' to disable.")
