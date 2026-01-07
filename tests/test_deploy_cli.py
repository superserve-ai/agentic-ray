"""Tests for rayai deploy CLI commands."""

import json
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from rayai.cli.cli import cli
from rayai.cli.platform.types import (
    Credentials,
    DeploymentResponse,
    DeviceCodeResponse,
    LogEntry,
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
    """Tests for rayai login command."""

    def test_login_with_api_key(self, runner):
        """Login with API key stores credentials."""
        with patch("rayai.cli.commands.login.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.validate_token.return_value = True
            mock_client_cls.return_value = mock_client

            with patch("rayai.cli.commands.login.save_credentials") as mock_save:
                result = runner.invoke(cli, ["login", "--api-key", "test-key-123"])

                assert result.exit_code == 0
                assert "Authenticated successfully" in result.output
                mock_save.assert_called_once()

    def test_login_with_invalid_api_key(self, runner):
        """Login with invalid API key fails."""
        with patch("rayai.cli.commands.login.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.validate_token.return_value = False
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["login", "--api-key", "bad-key"])

            assert result.exit_code == 1
            assert "Invalid API key" in result.output

    def test_login_device_flow(self, runner):
        """Login with device flow."""
        with patch("rayai.cli.commands.login.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get_device_code.return_value = DeviceCodeResponse(
                device_code="device-123",
                user_code="ABCD-1234",
                verification_uri="https://rayai.com/auth",
                verification_uri_complete="https://rayai.com/auth?code=ABCD-1234",
                expires_in=900,
                interval=1,
            )
            mock_client.poll_device_token.return_value = Credentials(
                token="device-token"
            )
            mock_client_cls.return_value = mock_client

            with patch("rayai.cli.commands.login.save_credentials"):
                with patch("rayai.cli.commands.login.webbrowser"):
                    result = runner.invoke(cli, ["login"])

                    assert result.exit_code == 0
                    assert "ABCD-1234" in result.output


class TestStatusCommand:
    """Tests for rayai status command."""

    def test_status_not_authenticated(self, runner):
        """Status command requires authentication."""
        with patch("rayai.cli.commands.status.is_authenticated", return_value=False):
            result = runner.invoke(cli, ["status"])

            assert result.exit_code == 1
            assert "Not logged in" in result.output

    def test_status_list_deployments(self, runner):
        """Status command lists deployments."""
        with patch("rayai.cli.commands.status.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.status.PlatformClient") as mock_client_cls:
                mock_client = MagicMock()
                mock_client.list_deployments.return_value = [
                    DeploymentResponse(
                        id="deploy-1",
                        name="myapp",
                        status="running",
                        url="https://myapp.rayai.com",
                        created_at="2025-01-01T00:00:00Z",
                    ),
                    DeploymentResponse(
                        id="deploy-2",
                        name="otherapp",
                        status="pending",
                        created_at="2025-01-02T00:00:00Z",
                    ),
                ]
                mock_client_cls.return_value = mock_client

                result = runner.invoke(cli, ["status"])

                assert result.exit_code == 0
                assert "myapp" in result.output
                assert "running" in result.output
                assert "otherapp" in result.output

    def test_status_specific_deployment(self, runner):
        """Status command for specific deployment."""
        with patch("rayai.cli.commands.status.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.status.PlatformClient") as mock_client_cls:
                mock_client = MagicMock()
                mock_client.get_deployment.return_value = DeploymentResponse(
                    id="deploy-1",
                    name="myapp",
                    status="running",
                    url="https://myapp.rayai.com",
                )
                mock_client_cls.return_value = mock_client

                result = runner.invoke(cli, ["status", "myapp"])

                assert result.exit_code == 0
                assert "myapp" in result.output
                assert "running" in result.output

    def test_status_json_output(self, runner):
        """Status command with JSON output."""
        with patch("rayai.cli.commands.status.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.status.PlatformClient") as mock_client_cls:
                mock_client = MagicMock()
                mock_client.get_deployment.return_value = DeploymentResponse(
                    id="deploy-1",
                    name="myapp",
                    status="running",
                )
                mock_client_cls.return_value = mock_client

                result = runner.invoke(cli, ["status", "myapp", "--json"])

                assert result.exit_code == 0
                # Output is a JSON list of deployments
                data = json.loads(result.output)
                assert isinstance(data, list)
                assert data[0]["id"] == "deploy-1"
                assert data[0]["name"] == "myapp"
                assert data[0]["status"] == "running"


class TestLogsCommand:
    """Tests for rayai logs command."""

    def test_logs_not_authenticated(self, runner):
        """Logs command requires authentication."""
        with patch("rayai.cli.commands.logs.is_authenticated", return_value=False):
            result = runner.invoke(cli, ["logs", "myapp"])

            assert result.exit_code == 1
            assert "Not logged in" in result.output

    def test_logs_basic(self, runner):
        """Logs command retrieves logs."""
        with patch("rayai.cli.commands.logs.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.logs.PlatformClient") as mock_client_cls:
                mock_client = MagicMock()
                mock_client.get_logs.return_value = [
                    LogEntry(
                        timestamp="2025-01-01T00:00:00Z",
                        level="INFO",
                        message="Agent started",
                        agent="myagent",
                    ),
                    LogEntry(
                        timestamp="2025-01-01T00:00:01Z",
                        level="INFO",
                        message="Request received",
                        agent="myagent",
                    ),
                ]
                mock_client_cls.return_value = mock_client

                result = runner.invoke(cli, ["logs", "myapp"])

                assert result.exit_code == 0
                assert "Agent started" in result.output
                assert "Request received" in result.output

    def test_logs_with_tail(self, runner):
        """Logs command with --tail option."""
        with patch("rayai.cli.commands.logs.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.logs.PlatformClient") as mock_client_cls:
                mock_client = MagicMock()
                mock_client.get_logs.return_value = []
                mock_client_cls.return_value = mock_client

                result = runner.invoke(cli, ["logs", "myapp", "--tail", "50"])

                assert result.exit_code == 0
                # Called with positional args: (name, tail, agent)
                mock_client.get_logs.assert_called_with("myapp", 50, None)

    def test_logs_with_agent_filter(self, runner):
        """Logs command with --agent filter."""
        with patch("rayai.cli.commands.logs.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.logs.PlatformClient") as mock_client_cls:
                mock_client = MagicMock()
                mock_client.get_logs.return_value = []
                mock_client_cls.return_value = mock_client

                result = runner.invoke(cli, ["logs", "myapp", "--agent", "myagent"])

                assert result.exit_code == 0
                # Called with positional args: (name, tail, agent)
                mock_client.get_logs.assert_called_with("myapp", 100, "myagent")


class TestDeleteCommand:
    """Tests for rayai delete command."""

    def test_delete_not_authenticated(self, runner):
        """Delete command requires authentication."""
        with patch("rayai.cli.commands.delete.is_authenticated", return_value=False):
            result = runner.invoke(cli, ["delete", "myapp"])

            assert result.exit_code == 1
            assert "Not logged in" in result.output

    def test_delete_with_confirmation(self, runner):
        """Delete command with confirmation."""
        with patch("rayai.cli.commands.delete.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.delete.PlatformClient") as mock_client_cls:
                mock_client = MagicMock()
                mock_client_cls.return_value = mock_client

                # Simulate user confirming deletion
                result = runner.invoke(cli, ["delete", "myapp"], input="y\n")

                assert result.exit_code == 0
                mock_client.delete_deployment.assert_called_once_with("myapp")
                assert "deleted" in result.output.lower()

    def test_delete_cancelled(self, runner):
        """Delete command cancelled by user."""
        with patch("rayai.cli.commands.delete.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.delete.PlatformClient") as mock_client_cls:
                mock_client = MagicMock()
                mock_client_cls.return_value = mock_client

                # Simulate user cancelling deletion
                # click.confirm with abort=True raises Abort on 'n', which exits with code 1
                result = runner.invoke(cli, ["delete", "myapp"], input="n\n")

                assert result.exit_code == 1  # Aborted
                mock_client.delete_deployment.assert_not_called()
                assert "Aborted" in result.output

    def test_delete_with_force(self, runner):
        """Delete command with --force skips confirmation."""
        with patch("rayai.cli.commands.delete.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.delete.PlatformClient") as mock_client_cls:
                mock_client = MagicMock()
                mock_client_cls.return_value = mock_client

                result = runner.invoke(cli, ["delete", "myapp", "--force"])

                assert result.exit_code == 0
                mock_client.delete_deployment.assert_called_once_with("myapp")


class TestDeployCommand:
    """Tests for rayai deploy command."""

    def test_deploy_not_authenticated(self, runner):
        """Deploy command requires authentication."""
        with patch("rayai.cli.commands.deploy.is_authenticated", return_value=False):
            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 1
            assert "Not logged in" in result.output

    def test_deploy_missing_agents_dir(self, runner, tmp_path):
        """Deploy command requires agents directory."""
        with patch("rayai.cli.commands.deploy.is_authenticated", return_value=True):
            result = runner.invoke(cli, ["deploy", str(tmp_path)])

            assert result.exit_code == 1
            assert "agents/ directory not found" in result.output

    def test_deploy_no_agents_found(self, runner, tmp_path):
        """Deploy command with no agents."""
        # Create empty agents directory
        (tmp_path / "agents").mkdir()

        with patch("rayai.cli.commands.deploy.is_authenticated", return_value=True):
            with patch("rayai.cli.commands.deploy._discover_agents", return_value=[]):
                result = runner.invoke(cli, ["deploy", str(tmp_path)])

                assert result.exit_code == 1
                assert "No agents found" in result.output


class TestWaitForDeployment:
    """Tests for _wait_for_deployment helper."""

    def test_wait_for_deployment_success(self):
        """Wait returns when deployment reaches running state."""
        from rayai.cli.commands.deploy import _wait_for_deployment
        from rayai.cli.platform.client import PlatformClient

        mock_client = MagicMock(spec=PlatformClient)
        mock_client.get_deployment.return_value = DeploymentResponse(
            id="deploy-1",
            name="myapp",
            status="running",
            url="https://myapp.rayai.com",
        )

        with patch("rayai.cli.commands.deploy.time.sleep"):
            result = _wait_for_deployment(mock_client, "myapp", timeout=60)

        assert result.status == "running"
        mock_client.get_deployment.assert_called_with("myapp")

    def test_wait_for_deployment_timeout(self):
        """Wait exits with error when timeout is exceeded."""
        from rayai.cli.commands.deploy import _wait_for_deployment
        from rayai.cli.platform.client import PlatformClient

        mock_client = MagicMock(spec=PlatformClient)
        # Always return pending status
        mock_client.get_deployment.return_value = DeploymentResponse(
            id="deploy-1",
            name="myapp",
            status="pending",
        )

        # Mock time to simulate timeout
        with patch("rayai.cli.commands.deploy.time.sleep"):
            with patch("rayai.cli.commands.deploy.time.time") as mock_time:
                # First call returns 0, subsequent calls return values > timeout
                mock_time.side_effect = [
                    0,
                    0,
                    100,
                ]  # start, first check (exceeds timeout=10)
                with pytest.raises(SystemExit) as exc:
                    _wait_for_deployment(mock_client, "myapp", timeout=10)

                assert exc.value.code == 1

    def test_wait_for_deployment_failed_state(self):
        """Wait returns when deployment reaches failed state."""
        from rayai.cli.commands.deploy import _wait_for_deployment
        from rayai.cli.platform.client import PlatformClient

        mock_client = MagicMock(spec=PlatformClient)
        mock_client.get_deployment.return_value = DeploymentResponse(
            id="deploy-1",
            name="myapp",
            status="failed",
            error="Build failed",
        )

        with patch("rayai.cli.commands.deploy.time.sleep"):
            result = _wait_for_deployment(mock_client, "myapp", timeout=60)

        assert result.status == "failed"
        assert result.error == "Build failed"


class TestPlatformClient:
    """Tests for PlatformClient HTTP client."""

    def test_client_initialization(self):
        """Client initializes with defaults."""
        from rayai.cli.platform.client import PlatformClient

        client = PlatformClient()
        # Default URL is localhost for dev, rayai.com for prod
        assert "localhost" in client.base_url or "rayai.com" in client.base_url

    def test_client_custom_url(self):
        """Client with custom base URL."""
        from rayai.cli.platform.client import PlatformClient

        client = PlatformClient(base_url="https://custom.api.com")
        assert client.base_url == "https://custom.api.com"

    def test_client_headers_authenticated(self):
        """Client includes auth header when authenticated."""
        from rayai.cli.platform.client import PlatformClient

        client = PlatformClient()

        with patch(
            "rayai.cli.platform.client.get_credentials",
            return_value=Credentials(token="test-token"),
        ):
            headers = client._get_headers(authenticated=True)
            assert "Authorization" in headers
            assert headers["Authorization"] == "Bearer test-token"

    def test_client_headers_unauthenticated(self):
        """Client without auth header for public endpoints."""
        from rayai.cli.platform.client import PlatformClient

        client = PlatformClient()
        headers = client._get_headers(authenticated=False)
        assert "Authorization" not in headers
        assert "User-Agent" in headers

    def test_client_not_authenticated_error(self):
        """Client raises error when not authenticated."""
        from rayai.cli.platform.client import PlatformAPIError, PlatformClient

        client = PlatformClient()

        with patch("rayai.cli.platform.client.get_credentials", return_value=None):
            with pytest.raises(PlatformAPIError) as exc:
                client._get_headers(authenticated=True)
            assert exc.value.status_code == 401


class TestPlatformAPIError:
    """Tests for PlatformAPIError exception."""

    def test_error_with_message(self):
        """Error with basic message."""
        from rayai.cli.platform.client import PlatformAPIError

        error = PlatformAPIError(404, "Deployment not found")
        assert error.status_code == 404
        assert error.message == "Deployment not found"
        assert "[404]" in str(error)

    def test_error_with_details(self):
        """Error with details dict."""
        from rayai.cli.platform.client import PlatformAPIError

        error = PlatformAPIError(
            400, "Validation error", {"field": "name", "issue": "required"}
        )
        assert error.status_code == 400
        assert error.details["field"] == "name"
