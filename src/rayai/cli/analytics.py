"""Anonymous usage analytics for RayAI CLI."""

import os
import uuid
from pathlib import Path

POSTHOG_API_KEY = "phc_gjpDKKKQJAnkxkqLrPGrAhoariKsaHNuTpI5rVhkYre"
POSTHOG_HOST = "https://us.i.posthog.com"

RAYAI_CONFIG_DIR = Path.home() / ".rayai"
ANONYMOUS_ID_FILE = RAYAI_CONFIG_DIR / "anonymous_id"
NOTICE_SHOWN_FILE = RAYAI_CONFIG_DIR / ".analytics_notice_shown"
ANALYTICS_DISABLED_FILE = RAYAI_CONFIG_DIR / ".analytics_disabled"


def _is_disabled() -> bool:
    """Check if analytics is disabled via command or environment variable."""
    if ANALYTICS_DISABLED_FILE.exists():
        return True
    return bool(os.getenv("RAYAI_DO_NOT_TRACK") or os.getenv("DO_NOT_TRACK"))


def _get_anonymous_id() -> str:
    """Get or create a persistent anonymous machine ID."""
    RAYAI_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    if ANONYMOUS_ID_FILE.exists():
        return ANONYMOUS_ID_FILE.read_text().strip()

    anonymous_id = str(uuid.uuid4())
    ANONYMOUS_ID_FILE.write_text(anonymous_id)
    return anonymous_id


def _show_notice_if_needed():
    """Show analytics notice on first run."""
    if _is_disabled() or NOTICE_SHOWN_FILE.exists():
        return

    RAYAI_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    NOTICE_SHOWN_FILE.touch()

    try:
        import click

        click.echo()
        click.echo(click.style("Analytics Notice:", bold=True))
        click.echo("RayAI collects anonymous usage data to improve the CLI.")
        click.echo("No personal data or code is collected.")
        click.echo(f"To opt out: {click.style('rayai analytics off', fg='cyan')}")
        click.echo()
    except ImportError:
        pass


def track(event: str, properties: dict | None = None):
    """
    Track an analytics event.

    Args:
        event: Event name (e.g., "cli_init", "cli_create_agent")
        properties: Optional dict of event properties
    """
    if _is_disabled():
        return

    _show_notice_if_needed()

    try:
        from posthog import Posthog

        posthog = Posthog(
            project_api_key=POSTHOG_API_KEY, host=POSTHOG_HOST, sync_mode=True
        )
        posthog.capture(
            distinct_id=_get_anonymous_id(),
            event=event,
            properties=properties or {},
        )
        posthog.shutdown()
    except Exception:
        pass  # Fail silently - analytics should never break the CLI
