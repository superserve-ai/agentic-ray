"""Tests for rayai.cli.platform module."""

import zipfile
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from rayai.cli.platform.auth import (
    clear_credentials,
    get_credentials,
    is_authenticated,
    save_credentials,
)
from rayai.cli.platform.types import (
    AgentManifest,
    Credentials,
    DeviceCodeResponse,
    LogEntry,
    ProjectManifest,
    ProjectResponse,
)


class TestCredentials:
    """Tests for Credentials model."""

    def test_create_credentials(self):
        """Create basic credentials."""
        creds = Credentials(token="test-token-123")
        assert creds.token == "test-token-123"
        assert creds.token_type == "Bearer"
        assert creds.expires_at is None
        assert creds.refresh_token is None

    def test_create_full_credentials(self):
        """Create credentials with all fields."""
        creds = Credentials(
            token="test-token-123",
            token_type="Bearer",
            expires_at="2025-12-31T23:59:59Z",
            refresh_token="refresh-123",
        )
        assert creds.token == "test-token-123"
        assert creds.expires_at == "2025-12-31T23:59:59Z"
        assert creds.refresh_token == "refresh-123"

    def test_credentials_json_serialization(self):
        """Credentials can be serialized to JSON."""
        creds = Credentials(token="test-token")
        json_str = creds.model_dump_json()
        assert "test-token" in json_str

    def test_credentials_from_json(self):
        """Credentials can be parsed from JSON."""
        json_str = '{"token": "parsed-token", "token_type": "Bearer"}'
        creds = Credentials.model_validate_json(json_str)
        assert creds.token == "parsed-token"

    def test_credentials_requires_token(self):
        """Token is required."""
        with pytest.raises(ValidationError):
            Credentials()


class TestAgentManifest:
    """Tests for AgentManifest model."""

    def test_create_agent_manifest(self):
        """Create basic agent manifest."""
        manifest = AgentManifest(
            name="myagent",
            route_prefix="/myagent",
            num_cpus=1,
            num_gpus=0,
            memory="2GB",
            replicas=1,
        )
        assert manifest.name == "myagent"
        assert manifest.route_prefix == "/myagent"
        assert manifest.num_cpus == 1
        assert manifest.replicas == 1

    def test_agent_manifest_float_cpus(self):
        """Agent manifest supports fractional CPUs."""
        manifest = AgentManifest(
            name="test",
            route_prefix="/test",
            num_cpus=0.5,
            num_gpus=0.25,
            memory="1GB",
            replicas=1,
        )
        assert manifest.num_cpus == 0.5
        assert manifest.num_gpus == 0.25


class TestProjectManifest:
    """Tests for ProjectManifest model."""

    def test_create_project_manifest(self):
        """Create project manifest."""
        manifest = ProjectManifest(
            name="myproject",
            python_version="3.11",
            created_at="2025-01-01T00:00:00Z",
        )
        assert manifest.name == "myproject"
        assert manifest.version == "1.0"
        assert manifest.agents == []

    def test_project_manifest_with_agents(self):
        """Project manifest with agents."""
        agent = AgentManifest(
            name="agent1",
            route_prefix="/agent1",
            num_cpus=2,
            num_gpus=0,
            memory="4GB",
            replicas=2,
        )
        manifest = ProjectManifest(
            name="myproject",
            python_version="3.11",
            agents=[agent],
        )
        assert len(manifest.agents) == 1
        assert manifest.agents[0].name == "agent1"


class TestProjectResponse:
    """Tests for ProjectResponse model."""

    def test_create_project_response(self):
        """Create project response."""
        response = ProjectResponse(
            id="project-123",
            name="myproject",
            status="running",
            url="https://myproject.rayai.com",
        )
        assert response.id == "project-123"
        assert response.status == "running"
        assert response.url == "https://myproject.rayai.com"

    def test_project_response_statuses(self):
        """Test valid project statuses."""
        for status in [
            "pending",
            "building",
            "deploying",
            "running",
            "failed",
            "stopped",
        ]:
            response = ProjectResponse(id="test", name="test", status=status)
            assert response.status == status

    def test_project_response_invalid_status(self):
        """Invalid status raises validation error."""
        with pytest.raises(ValidationError):
            ProjectResponse(id="test", name="test", status="invalid")


class TestDeviceCodeResponse:
    """Tests for DeviceCodeResponse model."""

    def test_create_device_code_response(self):
        """Create device code response."""
        response = DeviceCodeResponse(
            device_code="device-123",
            user_code="ABCD-1234",
            verification_uri="https://rayai.com/auth",
            verification_uri_complete="https://rayai.com/auth?code=ABCD-1234",
            expires_in=900,
            interval=5,
        )
        assert response.device_code == "device-123"
        assert response.user_code == "ABCD-1234"
        assert response.expires_in == 900


class TestLogEntry:
    """Tests for LogEntry model."""

    def test_create_log_entry(self):
        """Create log entry."""
        entry = LogEntry(
            timestamp="2025-01-01T00:00:00Z",
            level="INFO",
            message="Agent started",
            agent="myagent",
        )
        assert entry.timestamp == "2025-01-01T00:00:00Z"
        assert entry.level == "INFO"
        assert entry.agent == "myagent"

    def test_log_entry_no_agent(self):
        """Log entry without agent field."""
        entry = LogEntry(
            timestamp="2025-01-01T00:00:00Z",
            level="ERROR",
            message="System error",
        )
        assert entry.agent is None


class TestAuthModule:
    """Tests for auth module functions."""

    @pytest.fixture
    def temp_credentials_file(self, tmp_path):
        """Provide a temporary credentials file path."""
        creds_file = tmp_path / ".rayai" / "credentials.json"
        with patch("rayai.cli.platform.auth.CREDENTIALS_FILE", creds_file):
            yield creds_file

    def test_save_and_get_credentials(self, temp_credentials_file):
        """Save and retrieve credentials."""
        with patch("rayai.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file):
            creds = Credentials(token="save-test-token")
            save_credentials(creds)

            loaded = get_credentials()
            assert loaded is not None
            assert loaded.token == "save-test-token"

    def test_get_credentials_not_exists(self, temp_credentials_file):
        """Get credentials when file doesn't exist."""
        with patch("rayai.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file):
            assert get_credentials() is None

    def test_clear_credentials(self, temp_credentials_file):
        """Clear credentials removes the file."""
        with patch("rayai.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file):
            creds = Credentials(token="clear-test-token")
            save_credentials(creds)
            assert temp_credentials_file.exists()

            clear_credentials()
            assert not temp_credentials_file.exists()

    def test_is_authenticated(self, temp_credentials_file):
        """Check authentication status."""
        with patch("rayai.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file):
            assert not is_authenticated()

            save_credentials(Credentials(token="auth-test"))
            assert is_authenticated()

            clear_credentials()
            assert not is_authenticated()

    def test_credentials_file_permissions(self, temp_credentials_file):
        """Credentials file has restricted permissions."""
        with patch("rayai.cli.platform.auth.CREDENTIALS_FILE", temp_credentials_file):
            save_credentials(Credentials(token="perms-test"))
            # Check file mode is 0o600 (owner read/write only)
            mode = temp_credentials_file.stat().st_mode & 0o777
            assert mode == 0o600


class TestPackaging:
    """Tests for project packaging."""

    @pytest.fixture
    def temp_project(self, tmp_path):
        """Create a temporary project structure."""
        project_dir = tmp_path / "myproject"
        project_dir.mkdir()

        # Create agents directory with an agent
        agents_dir = project_dir / "agents"
        agents_dir.mkdir()
        agent_dir = agents_dir / "myagent"
        agent_dir.mkdir()
        (agent_dir / "agent.py").write_text("# Agent code")
        (agent_dir / "__init__.py").write_text("")

        # Create pyproject.toml (packaging now uses this instead of requirements.txt)
        (project_dir / "pyproject.toml").write_text(
            '[project]\nname = "myproject"\ndependencies = ["requests>=2.0"]\n'
        )

        return project_dir

    def test_package_project(self, temp_project):
        """Package project creates zip archive."""
        from rayai.cli.platform.packaging import package_project

        # Create mock agent configs
        class MockAgentConfig:
            name = "myagent"
            route_prefix = "/myagent"
            num_cpus = 1
            num_gpus = 0
            memory = "2GB"
            replicas = 1

        agents = [MockAgentConfig()]

        package_path, manifest = package_project(temp_project, agents, "test-project")

        try:
            assert package_path.exists()
            assert package_path.suffix == ".zip"
            assert manifest.name == "test-project"
            assert len(manifest.agents) == 1
            assert manifest.agents[0].name == "myagent"
            assert manifest.checksum  # Should have checksum

            # Verify zip contents
            with zipfile.ZipFile(package_path, "r") as zf:
                names = zf.namelist()
                assert "manifest.json" in names
                assert "pyproject.toml" in names
                assert any("agents/myagent" in n for n in names)
        finally:
            package_path.unlink(missing_ok=True)

    def test_package_excludes_pycache(self, temp_project):
        """Package excludes __pycache__ directories."""
        from rayai.cli.platform.packaging import package_project

        # Create __pycache__ directory
        pycache = temp_project / "agents" / "myagent" / "__pycache__"
        pycache.mkdir()
        (pycache / "agent.cpython-311.pyc").write_bytes(b"bytecode")

        class MockAgentConfig:
            name = "myagent"
            route_prefix = "/myagent"
            num_cpus = 1
            num_gpus = 0
            memory = "2GB"
            replicas = 1

        package_path, manifest = package_project(
            temp_project, [MockAgentConfig()], "test"
        )

        try:
            with zipfile.ZipFile(package_path, "r") as zf:
                names = zf.namelist()
                assert not any("__pycache__" in n for n in names)
                assert not any(".pyc" in n for n in names)
        finally:
            package_path.unlink(missing_ok=True)
