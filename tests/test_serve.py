"""Tests for rayai.serve() functionality."""

import pytest

from rayai.serve import (
    AgentConfig,
    clear_registered_agents,
    get_registered_agents,
    set_rayai_up_mode,
)


@pytest.fixture(autouse=True)
def reset_serve_state():
    """Reset serve module state before each test."""
    clear_registered_agents()
    set_rayai_up_mode(False)
    yield
    clear_registered_agents()
    set_rayai_up_mode(False)


class TestAgentConfig:
    """Tests for AgentConfig dataclass."""

    def test_create_config(self):
        """Create a basic config."""
        config = AgentConfig(
            agent="test_agent",
            name="test",
            host="0.0.0.0",
            port=8000,
            num_cpus=1,
            num_gpus=0,
            memory="2GB",
            replicas=1,
            route_prefix="/agents/test",
        )
        assert config.name == "test"
        assert config.port == 8000
        assert config.replicas == 1


class TestServeRegistration:
    """Tests for serve() registration behavior."""

    def test_rayai_up_mode_registration(self):
        """In rayai up mode, serve() registers agents."""
        from rayai.serve import serve

        set_rayai_up_mode(True)

        class DummyAgent:
            async def run(self, query: str) -> str:
                return query

        serve(DummyAgent(), name="dummy")

        registered = get_registered_agents()
        assert len(registered) == 1
        assert registered[0].name == "dummy"

    def test_multiple_registrations(self):
        """Multiple agents can be registered."""
        from rayai.serve import serve

        set_rayai_up_mode(True)

        serve(lambda x: x, name="agent1")
        serve(lambda x: x, name="agent2")
        serve(lambda x: x, name="agent3")

        registered = get_registered_agents()
        assert len(registered) == 3
        names = [r.name for r in registered]
        assert "agent1" in names
        assert "agent2" in names
        assert "agent3" in names

    def test_default_resources(self):
        """Default resource configuration."""
        from rayai.serve import serve

        set_rayai_up_mode(True)
        serve(lambda x: x, name="default")

        config = get_registered_agents()[0]
        assert config.num_cpus == 1
        assert config.num_gpus == 0
        assert config.memory == "2GB"
        assert config.replicas == 1

    def test_custom_resources(self):
        """Custom resource configuration."""
        from rayai.serve import serve

        set_rayai_up_mode(True)
        serve(
            lambda x: x,
            name="custom",
            num_cpus=4,
            num_gpus=1,
            memory="8GB",
            replicas=3,
        )

        config = get_registered_agents()[0]
        assert config.num_cpus == 4
        assert config.num_gpus == 1
        assert config.memory == "8GB"
        assert config.replicas == 3

    def test_route_prefix_default(self):
        """Default route prefix uses agent name."""
        from rayai.serve import serve

        set_rayai_up_mode(True)
        serve(lambda x: x, name="myagent")

        config = get_registered_agents()[0]
        assert config.route_prefix == "/myagent"

    def test_route_prefix_custom(self):
        """Custom route prefix."""
        from rayai.serve import serve

        set_rayai_up_mode(True)
        serve(lambda x: x, name="myagent", route_prefix="/custom/path")

        config = get_registered_agents()[0]
        assert config.route_prefix == "/custom/path"

    def test_clear_registered_agents(self):
        """Clear registered agents."""
        from rayai.serve import serve

        set_rayai_up_mode(True)
        serve(lambda x: x, name="agent1")
        serve(lambda x: x, name="agent2")

        assert len(get_registered_agents()) == 2

        clear_registered_agents()
        assert len(get_registered_agents()) == 0


class TestAgentTypeDetection:
    """Tests for agent type detection."""

    def test_callable_detection(self):
        """Callable agents are detected."""
        from rayai.serve import _AgentRunner

        def my_func(x):
            return x

        runner = _AgentRunner(my_func)
        assert runner.agent_type == "callable"

    def test_rayai_agent_detection(self):
        """RayAI Agent base class is detected."""
        from rayai import Agent
        from rayai.serve import _AgentRunner

        class MyAgent(Agent):
            async def run(self, query: str) -> str:
                return query

        runner = _AgentRunner(MyAgent())
        assert runner.agent_type == "rayai"
