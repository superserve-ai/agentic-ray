"""Authenticate with RayAI Cloud.

The `rayai login` command authenticates with the RayAI Platform API,
either using an API key or OAuth device flow.

Usage:
    rayai login                 # Interactive OAuth flow
    rayai login --api-key KEY   # API key authentication
    rayai login --logout        # Clear stored credentials
"""

import sys
import time
import webbrowser

import click

from rayai.cli.analytics import track
from rayai.cli.platform.auth import clear_credentials, get_credentials, save_credentials
from rayai.cli.platform.client import PlatformAPIError, PlatformClient
from rayai.cli.platform.config import DEVICE_POLL_INTERVAL
from rayai.cli.platform.types import Credentials


@click.command()
@click.option("--api-key", help="API key for authentication")
@click.option("--logout", is_flag=True, help="Log out and clear credentials")
def login(api_key: str | None, logout: bool) -> None:
    """Authenticate with RayAI Cloud.

    Authenticates using either an API key or interactive OAuth device flow.
    Credentials are stored in ~/.rayai/credentials.json.

    Examples:
        rayai login                 # Interactive OAuth flow
        rayai login --api-key KEY   # Use API key
        rayai login --logout        # Clear credentials
    """
    if logout:
        clear_credentials()
        click.echo("Logged out successfully.")
        return

    existing_creds = get_credentials()
    if existing_creds and not api_key:
        client = PlatformClient()
        if client.validate_token():
            click.echo("Already logged in. Use --logout to sign out.")
            return

    client = PlatformClient()

    if api_key:
        _login_with_api_key(client, api_key)
    else:
        _login_with_device_flow(client)

    track("cli_login", {})


def _login_with_api_key(client: PlatformClient, api_key: str) -> None:
    """Authenticate using an API key.

    Args:
        client: Platform API client.
        api_key: API key to use.
    """
    creds = Credentials(token=api_key)
    save_credentials(creds)

    if not client.validate_token():
        clear_credentials()
        click.echo("Error: Invalid API key", err=True)
        sys.exit(1)

    click.echo("Authenticated successfully with API key.")


def _login_with_device_flow(client: PlatformClient) -> None:
    """Authenticate using OAuth device flow.

    Args:
        client: Platform API client.
    """
    try:
        device = client.get_device_code()
    except PlatformAPIError as e:
        click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    click.echo(f"\nTo authenticate, visit: {device.verification_uri}")
    click.echo(f"Enter code: {click.style(device.user_code, bold=True)}\n")

    try:
        webbrowser.open(device.verification_uri_complete)
        click.echo("Browser opened automatically.")
    except Exception:
        click.echo("Please open the URL above in your browser.")

    click.echo("\nWaiting for authentication...")

    start = time.time()
    poll_interval = max(device.interval, DEVICE_POLL_INTERVAL)

    while time.time() - start < device.expires_in:
        try:
            creds = client.poll_device_token(device.device_code)
            save_credentials(creds)
            click.echo(click.style("\nAuthenticated successfully!", fg="green"))
            return
        except PlatformAPIError as e:
            oauth_error = e.details.get("oauth_error") if e.details else None
            if oauth_error == "authorization_pending":
                time.sleep(poll_interval)
            elif oauth_error == "slow_down":
                poll_interval += 1
                time.sleep(poll_interval)
            else:
                click.echo(f"\nError: {e.message}", err=True)
                sys.exit(1)

    click.echo("\nError: Authentication timed out", err=True)
    sys.exit(1)
