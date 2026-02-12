"""Authentication handling for Superserve SDK."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


class Credentials(BaseModel):
    """Stored authentication credentials."""

    api_key: str = Field(..., description="API key for authentication")
    token_type: str = Field(default="Bearer", description="Token type")


# Environment variable name for API key
SUPERSERVE_API_KEY_ENV = "SUPERSERVE_API_KEY"

# Default credentials file path
DEFAULT_CREDENTIALS_PATH = Path.home() / ".superserve" / "credentials.json"


def get_api_key(
    api_key: str | None = None,
    credentials_path: Path | None = None,
) -> str | None:
    """Get the API key from various sources.

    Checks in order of priority:
    1. Explicitly provided api_key parameter
    2. SUPERSERVE_API_KEY environment variable
    3. ~/.superserve/credentials.json file

    Args:
        api_key: Explicitly provided API key.
        credentials_path: Path to credentials file. Defaults to ~/.superserve/credentials.json.

    Returns:
        The API key if found, None otherwise.
    """
    # 1. Check explicit parameter
    if api_key:
        return api_key

    # 2. Check environment variable
    env_key = os.environ.get(SUPERSERVE_API_KEY_ENV)
    if env_key:
        return env_key

    # 3. Check credentials file
    creds_path = credentials_path or DEFAULT_CREDENTIALS_PATH
    if creds_path.exists():
        try:
            creds = load_credentials_from_file(creds_path)
            if creds:
                return creds.api_key
        except Exception:
            pass

    return None


def load_credentials_from_file(path: Path) -> Credentials | None:
    """Load credentials from a JSON file.

    Args:
        path: Path to the credentials file.

    Returns:
        Credentials if found and valid, None otherwise.
    """
    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text())

        # Handle different credential formats
        api_key = data.get("api_key") or data.get("token") or data.get("access_token")
        if not api_key:
            return None

        return Credentials(
            api_key=api_key,
            token_type=data.get("token_type", "Bearer"),
        )
    except (json.JSONDecodeError, OSError):
        return None


def save_credentials_to_file(
    api_key: str,
    path: Path | None = None,
    token_type: str = "Bearer",
) -> None:
    """Save credentials to a JSON file.

    Args:
        api_key: The API key to save.
        path: Path to save credentials. Defaults to ~/.superserve/credentials.json.
        token_type: Token type for the API key.
    """
    creds_path = path or DEFAULT_CREDENTIALS_PATH
    creds_path.parent.mkdir(parents=True, exist_ok=True)

    data: dict[str, Any] = {
        "api_key": api_key,
        "token_type": token_type,
    }

    creds_path.write_text(json.dumps(data, indent=2))

    # Set restrictive permissions
    creds_path.chmod(0o600)


def clear_credentials(path: Path | None = None) -> bool:
    """Clear saved credentials.

    Args:
        path: Path to credentials file. Defaults to ~/.superserve/credentials.json.

    Returns:
        True if credentials were cleared, False if file didn't exist.
    """
    creds_path = path or DEFAULT_CREDENTIALS_PATH

    if creds_path.exists():
        creds_path.unlink()
        return True

    return False


class AuthProvider:
    """Provider for authentication headers.

    This class manages API key resolution and provides authorization headers
    for HTTP requests.
    """

    def __init__(
        self,
        api_key: str | None = None,
        credentials_path: Path | None = None,
    ) -> None:
        """Initialize the auth provider.

        Args:
            api_key: Explicit API key to use.
            credentials_path: Path to credentials file.
        """
        self._api_key = api_key
        self._credentials_path = credentials_path
        self._resolved_key: str | None = None

    @property
    def api_key(self) -> str | None:
        """Get the resolved API key."""
        if self._resolved_key is None:
            self._resolved_key = get_api_key(
                api_key=self._api_key,
                credentials_path=self._credentials_path,
            )
        return self._resolved_key

    def get_headers(self) -> dict[str, str]:
        """Get authorization headers for requests.

        Returns:
            Headers dictionary with Authorization header if API key is available.

        Raises:
            ValueError: If no API key is available.
        """
        key = self.api_key
        if not key:
            raise ValueError(
                "No API key found. Set SUPERSERVE_API_KEY environment variable, "
                "pass api_key parameter, or save credentials to ~/.superserve/credentials.json"
            )

        return {"Authorization": f"Bearer {key}"}

    def refresh(self) -> None:
        """Clear cached key and re-resolve on next access."""
        self._resolved_key = None

    def is_authenticated(self) -> bool:
        """Check if an API key is available.

        Returns:
            True if API key is available, False otherwise.
        """
        return self.api_key is not None
