"""Tests for agent CRUD operations."""

from __future__ import annotations

import pytest
import respx
from httpx import Response

from superserve_sdk import Superserve
from superserve_sdk.exceptions import ConflictError, NotFoundError, ValidationError

from .conftest import (
    make_agent_dict,
)


class TestCreateAgent:
    """Tests for agent creation."""

    @pytest.mark.asyncio
    async def test_create_agent_success(self, api_base_url):
        """Test successful agent creation."""
        agent_data = make_agent_dict(name="new-agent")

        with respx.mock:
            respx.post(f"{api_base_url}/agents").mock(return_value=Response(201, json=agent_data))

            async with Superserve(api_key="sk_test") as client:
                agent = await client.create_agent(name="new-agent")

        assert agent.name == "new-agent"
        assert agent.id == "agt_test123"

    @pytest.mark.asyncio
    async def test_create_agent_with_all_options(self, api_base_url):
        """Test creating agent with all configuration options."""
        agent_data = make_agent_dict(
            name="configured-agent",
            model="claude-opus-4-20250514",
            system_prompt="You are an expert.",
            tools=["Read", "Write"],
            max_turns=20,
            timeout_seconds=600,
        )

        with respx.mock:
            respx.post(f"{api_base_url}/agents").mock(return_value=Response(201, json=agent_data))

            async with Superserve(api_key="sk_test") as client:
                agent = await client.create_agent(
                    name="configured-agent",
                    model="claude-opus-4-20250514",
                    system_prompt="You are an expert.",
                    tools=["Read", "Write"],
                    max_turns=20,
                    timeout_seconds=600,
                )

        assert agent.model == "claude-opus-4-20250514"
        assert agent.system_prompt == "You are an expert."
        assert agent.tools == ["Read", "Write"]
        assert agent.max_turns == 20
        assert agent.timeout_seconds == 600

    @pytest.mark.asyncio
    async def test_create_agent_conflict(self, api_base_url):
        """Test agent creation with name conflict."""
        with respx.mock:
            respx.post(f"{api_base_url}/agents").mock(
                return_value=Response(
                    409,
                    json={
                        "detail": "Agent with name 'existing' already exists",
                    },
                )
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(ConflictError) as exc_info:
                    await client.create_agent(name="existing")

        assert "already exists" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_agent_validation_error(self, api_base_url):
        """Test agent creation with validation error."""
        with respx.mock:
            respx.post(f"{api_base_url}/agents").mock(
                return_value=Response(
                    422,
                    json={
                        "detail": "Name must be alphanumeric",
                    },
                )
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(ValidationError):
                    await client.create_agent(name="invalid_name!")


class TestListAgents:
    """Tests for listing agents."""

    @pytest.mark.asyncio
    async def test_list_agents_success(self, api_base_url):
        """Test successful agent listing."""
        agents_data = [
            make_agent_dict(agent_id="agt_1", name="agent-1"),
            make_agent_dict(agent_id="agt_2", name="agent-2"),
        ]

        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": agents_data})
            )

            async with Superserve(api_key="sk_test") as client:
                agents = await client.list_agents()

        assert len(agents) == 2
        assert agents[0].name == "agent-1"
        assert agents[1].name == "agent-2"

    @pytest.mark.asyncio
    async def test_list_agents_with_pagination(self, api_base_url):
        """Test agent listing with pagination."""
        agents_data = [make_agent_dict()]

        with respx.mock:
            route = respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": agents_data})
            )

            async with Superserve(api_key="sk_test") as client:
                await client.list_agents(limit=10, offset=5)

        # Verify query params were sent
        request = route.calls[0].request
        assert "limit=10" in str(request.url)
        assert "offset=5" in str(request.url)

    @pytest.mark.asyncio
    async def test_list_agents_empty(self, api_base_url):
        """Test listing agents when none exist."""
        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": []})
            )

            async with Superserve(api_key="sk_test") as client:
                agents = await client.list_agents()

        assert agents == []


class TestGetAgent:
    """Tests for getting a single agent."""

    @pytest.mark.asyncio
    async def test_get_agent_by_id(self, api_base_url):
        """Test getting agent by ID."""
        agent_data = make_agent_dict(agent_id="agt_abc123")

        with respx.mock:
            respx.get(f"{api_base_url}/agents/agt_abc123").mock(
                return_value=Response(200, json=agent_data)
            )

            async with Superserve(api_key="sk_test") as client:
                agent = await client.get_agent("agt_abc123")

        assert agent.id == "agt_abc123"

    @pytest.mark.asyncio
    async def test_get_agent_by_name(self, api_base_url):
        """Test getting agent by name."""
        agents_data = [
            make_agent_dict(agent_id="agt_1", name="other-agent"),
            make_agent_dict(agent_id="agt_2", name="target-agent"),
        ]

        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": agents_data})
            )

            async with Superserve(api_key="sk_test") as client:
                agent = await client.get_agent("target-agent")

        assert agent.name == "target-agent"
        assert agent.id == "agt_2"

    @pytest.mark.asyncio
    async def test_get_agent_not_found_by_id(self, api_base_url):
        """Test getting non-existent agent by ID."""
        with respx.mock:
            respx.get(f"{api_base_url}/agents/agt_nonexistent").mock(
                return_value=Response(404, json={"detail": "Agent not found"})
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(NotFoundError):
                    await client.get_agent("agt_nonexistent")

    @pytest.mark.asyncio
    async def test_get_agent_not_found_by_name(self, api_base_url):
        """Test getting non-existent agent by name."""
        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": []})
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(NotFoundError) as exc_info:
                    await client.get_agent("nonexistent-agent")

        assert "nonexistent-agent" in str(exc_info.value)


class TestUpdateAgent:
    """Tests for updating agents."""

    @pytest.mark.asyncio
    async def test_update_agent_by_id(self, api_base_url):
        """Test updating agent by ID."""
        updated_agent = make_agent_dict(
            agent_id="agt_123",
            model="claude-opus-4-20250514",
        )

        with respx.mock:
            respx.patch(f"{api_base_url}/agents/agt_123").mock(
                return_value=Response(200, json=updated_agent)
            )

            async with Superserve(api_key="sk_test") as client:
                agent = await client.update_agent(
                    "agt_123",
                    model="claude-opus-4-20250514",
                )

        assert agent.model == "claude-opus-4-20250514"

    @pytest.mark.asyncio
    async def test_update_agent_by_name(self, api_base_url):
        """Test updating agent by name."""
        agents_data = [make_agent_dict(agent_id="agt_456", name="my-agent")]
        updated_agent = make_agent_dict(
            agent_id="agt_456",
            name="my-agent",
            max_turns=25,
        )

        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": agents_data})
            )
            respx.patch(f"{api_base_url}/agents/agt_456").mock(
                return_value=Response(200, json=updated_agent)
            )

            async with Superserve(api_key="sk_test") as client:
                agent = await client.update_agent("my-agent", max_turns=25)

        assert agent.max_turns == 25

    @pytest.mark.asyncio
    async def test_update_agent_partial(self, api_base_url):
        """Test partial agent update."""
        updated_agent = make_agent_dict(agent_id="agt_123")

        with respx.mock:
            route = respx.patch(f"{api_base_url}/agents/agt_123").mock(
                return_value=Response(200, json=updated_agent)
            )

            async with Superserve(api_key="sk_test") as client:
                await client.update_agent(
                    "agt_123",
                    system_prompt="New prompt",
                )

        # Verify only non-None fields are sent
        request = route.calls[0].request
        import json

        body = json.loads(request.content)
        assert body == {"system_prompt": "New prompt"}

    @pytest.mark.asyncio
    async def test_update_agent_not_found(self, api_base_url):
        """Test updating non-existent agent."""
        with respx.mock:
            respx.patch(f"{api_base_url}/agents/agt_nonexistent").mock(
                return_value=Response(404, json={"detail": "Agent not found"})
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(NotFoundError):
                    await client.update_agent("agt_nonexistent", max_turns=10)


class TestDeleteAgent:
    """Tests for deleting agents."""

    @pytest.mark.asyncio
    async def test_delete_agent_by_id(self, api_base_url):
        """Test deleting agent by ID."""
        with respx.mock:
            respx.delete(f"{api_base_url}/agents/agt_123").mock(return_value=Response(204))

            async with Superserve(api_key="sk_test") as client:
                await client.delete_agent("agt_123")

        # Should not raise

    @pytest.mark.asyncio
    async def test_delete_agent_by_name(self, api_base_url):
        """Test deleting agent by name."""
        agents_data = [make_agent_dict(agent_id="agt_789", name="delete-me")]

        with respx.mock:
            respx.get(f"{api_base_url}/agents").mock(
                return_value=Response(200, json={"agents": agents_data})
            )
            respx.delete(f"{api_base_url}/agents/agt_789").mock(return_value=Response(204))

            async with Superserve(api_key="sk_test") as client:
                await client.delete_agent("delete-me")

        # Should not raise

    @pytest.mark.asyncio
    async def test_delete_agent_not_found(self, api_base_url):
        """Test deleting non-existent agent."""
        with respx.mock:
            respx.delete(f"{api_base_url}/agents/agt_nonexistent").mock(
                return_value=Response(404, json={"detail": "Agent not found"})
            )

            async with Superserve(api_key="sk_test") as client:
                with pytest.raises(NotFoundError):
                    await client.delete_agent("agt_nonexistent")
