"""Tests for Pydantic models serialization/deserialization."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from superserve_sdk.models import (
    Agent,
    AgentConfig,
    AgentUpdateConfig,
    Run,
    RunCreateRequest,
    UsageMetrics,
)


class TestAgentConfig:
    """Tests for AgentConfig model."""

    def test_create_with_defaults(self):
        """Test creating config with default values."""
        config = AgentConfig(name="test-agent")

        assert config.name == "test-agent"
        assert config.model == "claude-sonnet-4-20250514"
        assert config.system_prompt == ""
        assert config.tools == ["Bash", "Read", "Write", "Glob", "Grep"]
        assert config.max_turns == 10
        assert config.timeout_seconds == 300

    def test_create_with_custom_values(self):
        """Test creating config with custom values."""
        config = AgentConfig(
            name="custom-agent",
            model="claude-opus-4-20250514",
            system_prompt="You are a helper.",
            tools=["Read", "Write"],
            max_turns=20,
            timeout_seconds=600,
        )

        assert config.name == "custom-agent"
        assert config.model == "claude-opus-4-20250514"
        assert config.system_prompt == "You are a helper."
        assert config.tools == ["Read", "Write"]
        assert config.max_turns == 20
        assert config.timeout_seconds == 600

    def test_name_validation_min_length(self):
        """Test name minimum length validation."""
        with pytest.raises(ValidationError) as exc_info:
            AgentConfig(name="")

        errors = exc_info.value.errors()
        assert len(errors) == 1
        assert errors[0]["loc"] == ("name",)

    def test_name_validation_max_length(self):
        """Test name maximum length validation."""
        with pytest.raises(ValidationError) as exc_info:
            AgentConfig(name="a" * 64)

        errors = exc_info.value.errors()
        assert len(errors) == 1
        assert errors[0]["loc"] == ("name",)

    def test_max_turns_validation(self):
        """Test max_turns bounds validation."""
        with pytest.raises(ValidationError):
            AgentConfig(name="test", max_turns=0)

        with pytest.raises(ValidationError):
            AgentConfig(name="test", max_turns=101)

        # Edge cases should work
        config_min = AgentConfig(name="test", max_turns=1)
        assert config_min.max_turns == 1

        config_max = AgentConfig(name="test", max_turns=100)
        assert config_max.max_turns == 100

    def test_timeout_validation(self):
        """Test timeout_seconds bounds validation."""
        with pytest.raises(ValidationError):
            AgentConfig(name="test", timeout_seconds=9)

        with pytest.raises(ValidationError):
            AgentConfig(name="test", timeout_seconds=3601)

        # Edge cases should work
        config_min = AgentConfig(name="test", timeout_seconds=10)
        assert config_min.timeout_seconds == 10

        config_max = AgentConfig(name="test", timeout_seconds=3600)
        assert config_max.timeout_seconds == 3600

    def test_serialization(self):
        """Test model serialization to dict."""
        config = AgentConfig(name="test-agent", max_turns=5)
        data = config.model_dump()

        assert data["name"] == "test-agent"
        assert data["max_turns"] == 5
        assert isinstance(data["tools"], list)


class TestAgentUpdateConfig:
    """Tests for AgentUpdateConfig model."""

    def test_all_fields_optional(self):
        """Test that all fields are optional."""
        config = AgentUpdateConfig()

        assert config.model is None
        assert config.system_prompt is None
        assert config.tools is None
        assert config.max_turns is None
        assert config.timeout_seconds is None

    def test_partial_update(self):
        """Test partial update with some fields."""
        config = AgentUpdateConfig(model="claude-opus-4-20250514", max_turns=15)

        assert config.model == "claude-opus-4-20250514"
        assert config.max_turns == 15
        assert config.system_prompt is None

    def test_exclude_none_serialization(self):
        """Test serialization excludes None values."""
        config = AgentUpdateConfig(model="claude-opus-4-20250514")
        data = {k: v for k, v in config.model_dump().items() if v is not None}

        assert data == {"model": "claude-opus-4-20250514"}


class TestAgent:
    """Tests for Agent model."""

    def test_parse_from_dict(self, mock_agent_data):
        """Test parsing agent from dictionary."""
        agent = Agent.model_validate(mock_agent_data)

        assert agent.id == "agt_test123"
        assert agent.name == "test-agent"
        assert agent.model == "claude-sonnet-4-20250514"
        assert agent.status == "active"
        assert isinstance(agent.created_at, datetime)
        assert isinstance(agent.updated_at, datetime)

    def test_agent_with_all_fields(self):
        """Test agent with all fields populated."""
        now = datetime.now(timezone.utc)
        agent = Agent(
            id="agt_123",
            name="my-agent",
            model="claude-sonnet-4-20250514",
            system_prompt="Test prompt",
            tools=["Bash", "Read"],
            max_turns=10,
            timeout_seconds=300,
            status="active",
            created_at=now,
            updated_at=now,
        )

        assert agent.id == "agt_123"
        assert agent.tools == ["Bash", "Read"]

    def test_agent_serialization_roundtrip(self, mock_agent_data):
        """Test agent serialization and deserialization roundtrip."""
        agent = Agent.model_validate(mock_agent_data)
        data = agent.model_dump(mode="json")
        agent_restored = Agent.model_validate(data)

        assert agent.id == agent_restored.id
        assert agent.name == agent_restored.name
        assert agent.model == agent_restored.model


class TestUsageMetrics:
    """Tests for UsageMetrics model."""

    def test_basic_creation(self):
        """Test creating usage metrics."""
        usage = UsageMetrics(
            input_tokens=100,
            output_tokens=50,
            total_tokens=150,
        )

        assert usage.input_tokens == 100
        assert usage.output_tokens == 50
        assert usage.total_tokens == 150

    def test_parse_from_dict(self):
        """Test parsing from dictionary."""
        data = {
            "input_tokens": 200,
            "output_tokens": 100,
            "total_tokens": 300,
        }
        usage = UsageMetrics.model_validate(data)

        assert usage.input_tokens == 200
        assert usage.output_tokens == 100
        assert usage.total_tokens == 300


class TestRun:
    """Tests for Run model."""

    def test_parse_completed_run(self, mock_run_data):
        """Test parsing a completed run."""
        run = Run.model_validate(mock_run_data)

        assert run.id == "run_test456"
        assert run.agent_id == "agt_test123"
        assert run.status == "completed"
        assert run.prompt == "Hello, world!"
        assert run.output == "Hello! How can I help you?"
        assert run.usage is not None
        assert run.usage.total_tokens == 150
        assert isinstance(run.created_at, datetime)

    def test_parse_pending_run(self):
        """Test parsing a pending run."""
        from tests.conftest import make_run_dict

        data = make_run_dict(status="pending", output=None)
        run = Run.model_validate(data)

        assert run.status == "pending"
        assert run.usage is None

    def test_parse_failed_run(self):
        """Test parsing a failed run."""
        from tests.conftest import make_run_dict

        data = make_run_dict(
            status="failed",
            output=None,
            error_message="Agent timed out",
        )
        run = Run.model_validate(data)

        assert run.status == "failed"
        assert run.error_message == "Agent timed out"

    def test_run_with_session(self):
        """Test run with session ID."""
        from tests.conftest import make_run_dict

        data = make_run_dict(session_id="session_abc123")
        run = Run.model_validate(data)

        assert run.session_id == "session_abc123"

    def test_run_with_tools_used(self):
        """Test run with tools used."""
        from tests.conftest import make_run_dict

        data = make_run_dict(tools_used=["Bash", "Read", "Write"])
        run = Run.model_validate(data)

        assert run.tools_used == ["Bash", "Read", "Write"]

    def test_run_serialization(self, mock_run_data):
        """Test run serialization."""
        run = Run.model_validate(mock_run_data)
        data = run.model_dump(mode="json")

        assert data["id"] == "run_test456"
        assert data["status"] == "completed"
        assert data["usage"]["total_tokens"] == 150


class TestRunCreateRequest:
    """Tests for RunCreateRequest model."""

    def test_create_request_basic(self):
        """Test creating a basic run request."""
        request = RunCreateRequest(
            agent_id="agt_123",
            prompt="Hello, world!",
        )

        assert request.agent_id == "agt_123"
        assert request.prompt == "Hello, world!"
        assert request.session_id is None

    def test_create_request_with_session(self):
        """Test creating a run request with session."""
        request = RunCreateRequest(
            agent_id="agt_123",
            prompt="Hello",
            session_id="session_abc",
        )

        assert request.session_id == "session_abc"

    def test_prompt_validation_min_length(self):
        """Test prompt minimum length validation."""
        with pytest.raises(ValidationError) as exc_info:
            RunCreateRequest(agent_id="agt_123", prompt="")

        errors = exc_info.value.errors()
        assert len(errors) == 1
        assert errors[0]["loc"] == ("prompt",)

    def test_prompt_validation_max_length(self):
        """Test prompt maximum length validation."""
        with pytest.raises(ValidationError) as exc_info:
            RunCreateRequest(agent_id="agt_123", prompt="x" * 100001)

        errors = exc_info.value.errors()
        assert len(errors) == 1
        assert errors[0]["loc"] == ("prompt",)

    def test_serialization(self):
        """Test request serialization."""
        request = RunCreateRequest(
            agent_id="agt_123",
            prompt="Test prompt",
            session_id="session_1",
        )
        data = request.model_dump()

        assert data["agent_id"] == "agt_123"
        assert data["prompt"] == "Test prompt"
        assert data["session_id"] == "session_1"
