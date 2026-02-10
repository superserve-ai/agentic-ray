"""Tests for MCP server CLI functionality."""

import os
import shutil
import tempfile
from pathlib import Path

import pytest
from click.testing import CliRunner

from superserve.mcp_serve import (
    MCPServerConfig,
    clear_registered_mcp_servers,
    get_registered_mcp_servers,
    set_superserve_mcp_up_mode,
)


@pytest.fixture(autouse=True)
def reset_mcp_serve_state():
    """Reset mcp_serve module state before each test."""
    clear_registered_mcp_servers()
    set_superserve_mcp_up_mode(False)
    yield
    clear_registered_mcp_servers()
    set_superserve_mcp_up_mode(False)


@pytest.fixture
def temp_project():
    """Create a temporary project directory."""
    temp_dir = tempfile.mkdtemp()
    original_cwd = os.getcwd()
    os.chdir(temp_dir)
    yield Path(temp_dir)
    os.chdir(original_cwd)
    shutil.rmtree(temp_dir)


class TestMCPServerConfig:
    """Tests for MCPServerConfig dataclass."""

    def test_create_config(self):
        """Create a basic config."""

        class MockMCP:
            pass

        config = MCPServerConfig(
            mcp_server=MockMCP(),
            name="test",
            num_cpus=1,
            num_gpus=0,
            memory="512MB",
            replicas=1,
            route_prefix="/test",
        )
        assert config.name == "test"
        assert config.num_cpus == 1
        assert config.memory == "512MB"
        assert config.replicas == 1

    def test_config_with_custom_resources(self):
        """Create config with custom resources."""

        class MockMCP:
            pass

        config = MCPServerConfig(
            mcp_server=MockMCP(),
            name="custom",
            num_cpus=2,
            num_gpus=1,
            memory="4GB",
            replicas=3,
            route_prefix="/custom/path",
        )
        assert config.num_cpus == 2
        assert config.num_gpus == 1
        assert config.memory == "4GB"
        assert config.replicas == 3
        assert config.route_prefix == "/custom/path"


class TestServeMCPRegistration:
    """Tests for serve_mcp() registration behavior."""

    def test_superserve_mcp_up_mode_registration(self):
        """In superserve mcp up mode, serve_mcp() registers servers."""
        from superserve.mcp_serve import serve_mcp

        set_superserve_mcp_up_mode(True)

        class MockMCP:
            pass

        serve_mcp(MockMCP(), name="test_mcp")

        registered = get_registered_mcp_servers()
        assert len(registered) == 1
        assert registered[0].name == "test_mcp"

    def test_multiple_registrations(self):
        """Multiple MCP servers can be registered."""
        from superserve.mcp_serve import serve_mcp

        set_superserve_mcp_up_mode(True)

        class MockMCP:
            pass

        serve_mcp(MockMCP(), name="server1")
        serve_mcp(MockMCP(), name="server2")
        serve_mcp(MockMCP(), name="server3")

        registered = get_registered_mcp_servers()
        assert len(registered) == 3
        names = [r.name for r in registered]
        assert "server1" in names
        assert "server2" in names
        assert "server3" in names

    def test_default_resources(self):
        """Default resource configuration."""
        from superserve.mcp_serve import serve_mcp

        set_superserve_mcp_up_mode(True)

        class MockMCP:
            pass

        serve_mcp(MockMCP(), name="default")

        config = get_registered_mcp_servers()[0]
        assert config.num_cpus == 1
        assert config.num_gpus == 0
        assert config.memory == "512MB"
        assert config.replicas == 1

    def test_custom_resources(self):
        """Custom resource configuration."""
        from superserve.mcp_serve import serve_mcp

        set_superserve_mcp_up_mode(True)

        class MockMCP:
            pass

        serve_mcp(
            MockMCP(),
            name="custom",
            num_cpus=4,
            num_gpus=1,
            memory="8GB",
            replicas=3,
        )

        config = get_registered_mcp_servers()[0]
        assert config.num_cpus == 4
        assert config.num_gpus == 1
        assert config.memory == "8GB"
        assert config.replicas == 3

    def test_route_prefix_default(self):
        """Default route prefix uses server name."""
        from superserve.mcp_serve import serve_mcp

        set_superserve_mcp_up_mode(True)

        class MockMCP:
            pass

        serve_mcp(MockMCP(), name="myserver")

        config = get_registered_mcp_servers()[0]
        assert config.route_prefix == "/myserver"

    def test_route_prefix_custom(self):
        """Custom route prefix."""
        from superserve.mcp_serve import serve_mcp

        set_superserve_mcp_up_mode(True)

        class MockMCP:
            pass

        serve_mcp(MockMCP(), name="myserver", route_prefix="/custom/prefix")

        config = get_registered_mcp_servers()[0]
        assert config.route_prefix == "/custom/prefix"

    def test_clear_registered_servers(self):
        """Clear registered MCP servers."""
        from superserve.mcp_serve import serve_mcp

        set_superserve_mcp_up_mode(True)

        class MockMCP:
            pass

        serve_mcp(MockMCP(), name="server1")
        serve_mcp(MockMCP(), name="server2")

        assert len(get_registered_mcp_servers()) == 2

        clear_registered_mcp_servers()
        assert len(get_registered_mcp_servers()) == 0


class TestRunFunction:
    """Tests for run() function."""

    def test_run_raises_without_servers(self):
        """run() raises error when no servers registered."""
        from superserve.mcp_serve import run

        with pytest.raises(RuntimeError, match="No MCP servers registered"):
            run()


class TestMCPUpCommand:
    """Tests for superserve mcp up command."""

    def test_mcp_up_no_mcp_servers_dir(self, temp_project):
        """mcp up fails without mcp_servers/ directory."""
        from superserve.cli.cli import cli

        runner = CliRunner()
        result = runner.invoke(cli, ["mcp", "up"])

        assert result.exit_code != 0
        assert "mcp_servers/ directory not found" in result.output

    def test_mcp_up_empty_directory(self, temp_project):
        """mcp up fails with empty mcp_servers/ directory."""
        from superserve.cli.cli import cli

        # Create empty mcp_servers directory
        (temp_project / "mcp_servers").mkdir()
        (temp_project / "mcp_servers" / "__init__.py").write_text("")

        runner = CliRunner()
        result = runner.invoke(cli, ["mcp", "up"])

        assert result.exit_code != 0
        assert "No server modules found" in result.output

    def test_mcp_up_missing_server_py(self, temp_project):
        """mcp up warns about directories without server.py."""
        from superserve.cli.cli import cli

        # Create mcp_servers with empty subdirectory
        (temp_project / "mcp_servers").mkdir()
        (temp_project / "mcp_servers" / "__init__.py").write_text("")
        (temp_project / "mcp_servers" / "incomplete").mkdir()
        (temp_project / "mcp_servers" / "incomplete" / "__init__.py").write_text("")

        runner = CliRunner()
        result = runner.invoke(cli, ["mcp", "up"])

        assert "Warning: No server.py in incomplete/, skipping" in result.output


class TestMCPCommandGroup:
    """Tests for superserve mcp command group."""

    def test_mcp_help(self):
        """mcp --help shows available commands."""
        from superserve.cli.cli import cli

        runner = CliRunner()
        result = runner.invoke(cli, ["mcp", "--help"])

        assert result.exit_code == 0
        assert "Manage MCP servers" in result.output
        assert "up" in result.output

    def test_mcp_up_help(self):
        """mcp up --help shows options."""
        from superserve.cli.cli import cli

        runner = CliRunner()
        result = runner.invoke(cli, ["mcp", "up", "--help"])

        assert result.exit_code == 0
        assert "--port" in result.output
        assert "--host" in result.output
        assert "--servers" in result.output
