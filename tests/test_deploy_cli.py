"""Tests for superserve deploy CLI commands."""

from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from superserve.cli.cli import cli
from superserve.cli.platform.types import (
    Credentials,
    DeviceCodeResponse,
)


@pytest.fixture
def runner():
    """Provide a CLI runner."""
    return CliRunner()


@pytest.fixture
def mock_credentials():
    """Mock authenticated credentials."""
    return Credentials(token="test-token-123")


class TestLoginCommand:
    """Tests for superserve login command."""

    def test_login_with_api_key(self, runner):
        """Login with API key stores credentials."""
        with patch("superserve.cli.commands.login.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.validate_token.return_value = True
            mock_client_cls.return_value = mock_client

            with patch("superserve.cli.commands.login.save_credentials") as mock_save:
                result = runner.invoke(cli, ["login", "--api-key", "test-key-123"])

                assert result.exit_code == 0
                assert "Authenticated successfully" in result.output
                mock_save.assert_called_once()

    def test_login_with_invalid_api_key(self, runner):
        """Login with invalid API key fails."""
        with patch("superserve.cli.commands.login.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.validate_token.return_value = False
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["login", "--api-key", "bad-key"])

            assert result.exit_code == 1
            assert "Invalid API key" in result.output

    def test_login_device_flow(self, runner):
        """Login with device flow."""
        with patch("superserve.cli.commands.login.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get_device_code.return_value = DeviceCodeResponse(
                device_code="device-123",
                user_code="ABCD-1234",
                verification_uri="https://superserve.com/auth",
                verification_uri_complete="https://superserve.com/auth?code=ABCD-1234",
                expires_in=900,
                interval=1,
            )
            mock_client.poll_device_token.return_value = Credentials(
                token="device-token"
            )
            mock_client_cls.return_value = mock_client

            with patch("superserve.cli.commands.login.save_credentials"):
                with patch("superserve.cli.commands.login.webbrowser"):
                    result = runner.invoke(cli, ["login"])

                    assert result.exit_code == 0
                    assert "ABCD-1234" in result.output


class TestPlatformClient:
    """Tests for PlatformClient HTTP client."""

    def test_client_initialization(self):
        """Client initializes with defaults."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient()
        assert "superserve" in client.base_url

    def test_client_custom_url(self):
        """Client with custom base URL."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient(base_url="https://custom.api.com")
        assert client.base_url == "https://custom.api.com"

    def test_client_headers_authenticated(self):
        """Client includes auth header when authenticated."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient()

        with patch(
            "superserve.cli.platform.client.get_credentials",
            return_value=Credentials(token="test-token"),
        ):
            headers = client._get_headers(authenticated=True)
            assert "Authorization" in headers
            assert headers["Authorization"] == "Bearer test-token"

    def test_client_headers_unauthenticated(self):
        """Client without auth header for public endpoints."""
        from superserve.cli.platform.client import PlatformClient

        client = PlatformClient()
        headers = client._get_headers(authenticated=False)
        assert "Authorization" not in headers
        assert "User-Agent" in headers

    def test_client_not_authenticated_error(self):
        """Client raises error when not authenticated."""
        from superserve.cli.platform.client import PlatformAPIError, PlatformClient

        client = PlatformClient()

        with patch("superserve.cli.platform.client.get_credentials", return_value=None):
            with pytest.raises(PlatformAPIError) as exc:
                client._get_headers(authenticated=True)
            assert exc.value.status_code == 401


class TestPlatformAPIError:
    """Tests for PlatformAPIError exception."""

    def test_error_with_message(self):
        """Error with basic message."""
        from superserve.cli.platform.client import PlatformAPIError

        error = PlatformAPIError(404, "Project not found")
        assert error.status_code == 404
        assert error.message == "Project not found"
        assert "[404]" in str(error)

    def test_error_with_details(self):
        """Error with details dict."""
        from superserve.cli.platform.client import PlatformAPIError

        error = PlatformAPIError(
            400, "Validation error", {"field": "name", "issue": "required"}
        )
        assert error.status_code == 400
        assert error.details["field"] == "name"
