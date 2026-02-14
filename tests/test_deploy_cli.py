"""Tests for superserve init and deploy CLI commands."""

import json
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from superserve.cli.cli import cli
from superserve.cli.platform.client import PlatformAPIError
from superserve.cli.platform.types import AgentResponse


@pytest.fixture
def runner():
    """Provide a CLI runner."""
    return CliRunner()


def _make_agent_response(**overrides) -> AgentResponse:
    """Helper to create an AgentResponse with defaults."""
    defaults = {
        "id": "agt_test-uuid",
        "name": "my-agent",
        "command": "python main.py",
        "environment_keys": [],
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    defaults.update(overrides)
    return AgentResponse(**defaults)


# ==================== Init Command ====================


class TestInitCommand:
    """Tests for superserve init command."""

    def test_init_creates_yaml(self, runner, tmp_path, monkeypatch):
        """Init creates superserve.yaml in current directory."""
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(cli, ["init"])

        assert result.exit_code == 0
        assert "Created superserve.yaml" in result.output
        assert "command" in result.output
        assert "superserve deploy" in result.output

    def test_init_with_name(self, runner, tmp_path, monkeypatch):
        """Init uses provided name."""
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(cli, ["init", "--name", "my-agent"])

        assert result.exit_code == 0
        yaml_content = (tmp_path / "superserve.yaml").read_text()
        assert "name: my-agent" in yaml_content

    def test_init_refuses_if_exists(self, runner, tmp_path, monkeypatch):
        """Init refuses if superserve.yaml already exists."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text("name: existing\n")

        result = runner.invoke(cli, ["init"])

        assert result.exit_code == 1
        assert "already exists" in result.output

    def test_init_default_name_from_dir(self, runner, tmp_path, monkeypatch):
        """Init defaults name to directory name."""
        project_dir = tmp_path / "my-cool-project"
        project_dir.mkdir()
        monkeypatch.chdir(project_dir)

        result = runner.invoke(cli, ["init"])

        assert result.exit_code == 0
        yaml_content = (project_dir / "superserve.yaml").read_text()
        assert "name: my-cool-project" in yaml_content

    def test_init_yaml_has_ignore_section(self, runner, tmp_path, monkeypatch):
        """Init template includes commented ignore section."""
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(cli, ["init"])

        assert result.exit_code == 0
        yaml_content = (tmp_path / "superserve.yaml").read_text()
        assert "ignore:" in yaml_content


# ==================== Deploy Command ====================


class TestDeployCommand:
    """Tests for superserve deploy command."""

    def test_deploy_requires_yaml(self, runner, tmp_path, monkeypatch):
        """Deploy fails if superserve.yaml not found."""
        monkeypatch.chdir(tmp_path)

        result = runner.invoke(cli, ["deploy"])

        assert result.exit_code == 1
        assert "not found" in result.output.lower()
        assert "superserve init" in result.output

    def test_deploy_requires_name(self, runner, tmp_path, monkeypatch):
        """Deploy fails if name missing from yaml."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text("command: python main.py\n")

        result = runner.invoke(cli, ["deploy"])

        assert result.exit_code == 1
        assert "name" in result.output.lower()

    def test_deploy_requires_command(self, runner, tmp_path, monkeypatch):
        """Deploy fails if command missing from yaml."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text("name: my-agent\n")

        result = runner.invoke(cli, ["deploy"])

        assert result.exit_code == 1
        assert "command" in result.output.lower()

    def test_deploy_success(self, runner, tmp_path, monkeypatch):
        """Deploy packages and uploads successfully."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 0
            assert "Deployed" in result.output
            assert "my-agent" in result.output
            mock_client.deploy_agent.assert_called_once()

    def test_deploy_json_output(self, runner, tmp_path, monkeypatch):
        """Deploy with --json outputs JSON."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy", "--json"])

            assert result.exit_code == 0
            data = json.loads(result.output)
            assert data["name"] == "my-agent"

    def test_deploy_not_authenticated(self, runner, tmp_path, monkeypatch):
        """Deploy shows auth error."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.side_effect = PlatformAPIError(
                401, "Not authenticated"
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 1
            assert "login" in result.output.lower()

    def test_deploy_excludes_default_dirs(self, runner, tmp_path, monkeypatch):
        """Deploy excludes __pycache__, .git, .venv by default."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")
        (tmp_path / "__pycache__").mkdir()
        (tmp_path / "__pycache__" / "module.pyc").write_text("bytecode")
        (tmp_path / ".git").mkdir()
        (tmp_path / ".git" / "config").write_text("gitconfig")
        (tmp_path / ".env").write_text("SECRET=value")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 0
            mock_client.deploy_agent.assert_called_once()

    def test_deploy_excludes_user_ignores(self, runner, tmp_path, monkeypatch):
        """Deploy excludes paths listed in ignore field."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\nignore:\n  - data\n  - logs\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "big.csv").write_text("a,b,c")
        (tmp_path / "logs").mkdir()
        (tmp_path / "logs" / "app.log").write_text("log line")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 0
            mock_client.deploy_agent.assert_called_once()
