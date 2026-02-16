"""CLI integration tests against staging API.

Tests invoke actual CLI commands via CliRunner pointed at the real staging API.
Requires E2E_API_TOKEN env var; auto-skipped if not set.

Environment:
    E2E_API_URL: API base URL (default: https://api-staging.superserve.ai)
    E2E_API_TOKEN: API key in rayai_* format (required)
    ANTHROPIC_API_KEY: Required for run/session tests
"""

import io
import json
import os
import tarfile
import uuid

import pytest
import requests
from click.testing import CliRunner

from superserve.cli.cli import cli
from superserve.cli.platform.client import PlatformClient
from superserve.cli.platform.types import Credentials

E2E_API_URL = os.getenv("E2E_API_URL", "https://api-staging.superserve.ai")
E2E_API_TOKEN = os.getenv("E2E_API_TOKEN")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

pytestmark = pytest.mark.skipif(
    not E2E_API_TOKEN,
    reason="E2E_API_TOKEN not set",
)

# Check whether deploy/init commands are available (amit/deploy-cli branch)
try:
    from superserve.cli.commands.deploy import deploy as _deploy_cmd  # noqa: F401
    from superserve.cli.commands.init import init as _init_cmd  # noqa: F401

    HAS_DEPLOY = True
except ImportError:
    HAS_DEPLOY = False

requires_anthropic = pytest.mark.skipif(
    not ANTHROPIC_API_KEY,
    reason="ANTHROPIC_API_KEY not set",
)

requires_deploy = pytest.mark.skipif(
    not HAS_DEPLOY,
    reason="deploy/init commands not available (need amit/deploy-cli branch)",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _unique_name(prefix: str = "cli-test") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _make_dummy_tarball() -> bytes:
    """Create a minimal tarball with a hello-world main.py."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        data = b"print('hello from cli integration test')\n"
        info = tarfile.TarInfo(name="main.py")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _deploy_via_api(name: str, tarball: bytes | None = None) -> dict:
    """Deploy an agent via direct API call (bypasses CLI)."""
    if tarball is None:
        tarball = _make_dummy_tarball()
    resp = requests.post(
        f"{E2E_API_URL}/v1/agents",
        headers={"Authorization": f"Bearer {E2E_API_TOKEN}"},
        data={"name": name, "command": "python main.py", "config": "{}"},
        files={"file": ("agent.tar.gz", tarball, "application/gzip")},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _delete_via_api(agent_id: str) -> None:
    """Delete an agent via direct API call."""
    try:
        requests.delete(
            f"{E2E_API_URL}/v1/agents/{agent_id}",
            headers={"Authorization": f"Bearer {E2E_API_TOKEN}"},
            timeout=10,
        )
    except Exception:
        pass


def _make_sdk_agent_tarball() -> bytes:
    """Create a tarball with an agent that uses claude_agent_sdk."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        main_py = b"""\
import asyncio
import json
import os
import sys

from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, TextBlock, ResultMessage

async def main():
    prompt = os.environ.get("SUPERSERVE_PROMPT", "Hello")
    session_id = os.environ.get("SUPERSERVE_SESSION_ID")

    options = ClaudeAgentOptions(
        model="claude-haiku-4-5-20251001",
        max_turns=3,
        permission_mode="bypassPermissions",
    )
    if session_id:
        options.resume = session_id

    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text, flush=True)
        elif isinstance(message, ResultMessage):
            print(f"__SUPERSERVE_SESSION_ID__:{message.session_id}", flush=True)
            usage = {
                "input_tokens": getattr(message, "input_tokens", 0) or 0,
                "output_tokens": getattr(message, "output_tokens", 0) or 0,
                "num_turns": getattr(message, "num_turns", 0) or 0,
                "tools_used": getattr(message, "tools_used", []) or [],
            }
            print(f"__SUPERSERVE_USAGE__:{json.dumps(usage)}", flush=True)

asyncio.run(main())
"""
        info = tarfile.TarInfo(name="main.py")
        info.size = len(main_py)
        tar.addfile(info, io.BytesIO(main_py))
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture(autouse=True)
def patch_auth(monkeypatch):
    """Point CLI at staging API with real credentials."""
    creds = Credentials(token=E2E_API_TOKEN)
    monkeypatch.setattr("superserve.cli.platform.auth.get_credentials", lambda: creds)
    # Override default base URL — PlatformClient.__init__ default arg was bound
    # at import time, so we must patch the class __init__ itself.
    original_init = PlatformClient.__init__

    def patched_init(self, base_url=E2E_API_URL, timeout=120):
        original_init(self, base_url=base_url, timeout=timeout)

    monkeypatch.setattr(PlatformClient, "__init__", patched_init)


@pytest.fixture
def cleanup_agents():
    """Track agent IDs for cleanup after test."""
    agent_ids: list[str] = []
    yield agent_ids
    for agent_id in agent_ids:
        _delete_via_api(agent_id)


@pytest.fixture
def deployed_agent(cleanup_agents):
    """Deploy a minimal agent via API and return (name, agent_dict)."""
    name = _unique_name()
    agent = _deploy_via_api(name)
    cleanup_agents.append(agent["id"])
    return name, agent


@pytest.fixture
def deployed_sdk_agent(cleanup_agents):
    """Deploy an SDK agent with ANTHROPIC_API_KEY secret set."""
    name = _unique_name("sdk-test")
    agent = _deploy_via_api(name, tarball=_make_sdk_agent_tarball())
    cleanup_agents.append(agent["id"])
    # Set ANTHROPIC_API_KEY secret
    requests.patch(
        f"{E2E_API_URL}/v1/agents/{agent['id']}/secrets",
        headers={"Authorization": f"Bearer {E2E_API_TOKEN}"},
        json={"secrets": {"ANTHROPIC_API_KEY": ANTHROPIC_API_KEY}},
        timeout=10,
    )
    return name, agent


# ---------------------------------------------------------------------------
# Init Command (requires amit/deploy-cli branch)
# ---------------------------------------------------------------------------


@requires_deploy
class TestInitCommand:
    """Tests for `superserve init`."""

    def test_init_creates_yaml(self, runner):
        """Run init in temp dir → verify superserve.yaml created."""
        with runner.isolated_filesystem():
            result = runner.invoke(cli, ["init", "--name", "test-agent"])
            assert result.exit_code == 0, result.output
            assert "Created superserve.yaml" in result.output

            from pathlib import Path

            config_path = Path("superserve.yaml")
            assert config_path.exists()
            content = config_path.read_text()
            assert "name: test-agent" in content
            assert "command:" in content

    def test_init_refuses_overwrite(self, runner):
        """Running init twice should fail on second invocation."""
        with runner.isolated_filesystem():
            result1 = runner.invoke(cli, ["init", "--name", "test-agent"])
            assert result1.exit_code == 0

            result2 = runner.invoke(cli, ["init", "--name", "test-agent"])
            assert result2.exit_code != 0
            assert "already exists" in result2.output


# ---------------------------------------------------------------------------
# Deploy Command (requires amit/deploy-cli branch)
# ---------------------------------------------------------------------------


@requires_deploy
class TestDeployCommand:
    """Tests for `superserve deploy`."""

    def test_deploy_creates_agent(self, runner, cleanup_agents):
        """Deploy from a project dir → verify agent created."""
        name = _unique_name("deploy")
        with runner.isolated_filesystem():
            from pathlib import Path

            Path("superserve.yaml").write_text(
                f"name: {name}\ncommand: python main.py\n"
            )
            Path("main.py").write_text("print('hello')\n")

            result = runner.invoke(cli, ["deploy"])

        assert result.exit_code == 0, result.output
        assert name in result.output

        # Extract agent ID for cleanup — parse "Deployed 'name' (agt_...)"
        for line in result.output.splitlines():
            if "Deployed" in line and "(" in line:
                agent_id = line.split("(")[1].rstrip(")")
                cleanup_agents.append(agent_id)
                break

    def test_deploy_upsert(self, runner, cleanup_agents):
        """Deploying same name twice → same agent ID."""
        name = _unique_name("upsert")
        with runner.isolated_filesystem():
            from pathlib import Path

            Path("superserve.yaml").write_text(
                f"name: {name}\ncommand: python main.py\n"
            )
            Path("main.py").write_text("print('hello')\n")

            result1 = runner.invoke(cli, ["deploy", "--json"])
            assert result1.exit_code == 0, result1.output
            agent1 = json.loads(result1.output)
            cleanup_agents.append(agent1["id"])

            result2 = runner.invoke(cli, ["deploy", "--json"])
            assert result2.exit_code == 0, result2.output
            agent2 = json.loads(result2.output)

        assert agent1["id"] == agent2["id"]

    def test_deploy_with_ignore(self, runner, cleanup_agents):
        """Deploy with .venv/ in ignore → agent still deploys."""
        name = _unique_name("ignore")
        with runner.isolated_filesystem():
            from pathlib import Path

            Path("superserve.yaml").write_text(
                f"name: {name}\ncommand: python main.py\nignore:\n  - .venv\n"
            )
            Path("main.py").write_text("print('hello')\n")
            venv_dir = Path(".venv")
            venv_dir.mkdir()
            (venv_dir / "big_file.bin").write_bytes(b"\x00" * 1024)

            result = runner.invoke(cli, ["deploy", "--json"])

        assert result.exit_code == 0, result.output
        agent = json.loads(result.output)
        cleanup_agents.append(agent["id"])
        assert agent["name"] == name


# ---------------------------------------------------------------------------
# Agents Commands
# ---------------------------------------------------------------------------


class TestAgentsCommands:
    """Tests for `superserve agents list|get|delete`."""

    def test_agents_list(self, runner, deployed_agent):
        """Deployed agent appears in agents list."""
        name, _agent = deployed_agent
        result = runner.invoke(cli, ["agents", "list"])
        assert result.exit_code == 0, result.output
        assert name in result.output

    def test_agents_get(self, runner, deployed_agent):
        """Get agent details by name."""
        name, agent = deployed_agent
        result = runner.invoke(cli, ["agents", "get", name])
        assert result.exit_code == 0, result.output
        assert name in result.output
        assert agent["id"] in result.output

    def test_agents_delete(self, runner, cleanup_agents):
        """Delete agent via CLI, then verify it's gone."""
        name = _unique_name("del")
        _deploy_via_api(name)
        # Don't add to cleanup_agents — we're deleting it in the test

        result = runner.invoke(cli, ["agents", "delete", name, "-y"])
        assert result.exit_code == 0, result.output
        assert "Deleted" in result.output or "deleted" in result.output.lower()

        # Verify agent is gone
        get_result = runner.invoke(cli, ["agents", "get", name])
        assert get_result.exit_code != 0 or "not found" in get_result.output.lower()


# ---------------------------------------------------------------------------
# Secrets Commands
# ---------------------------------------------------------------------------


class TestSecretsCommands:
    """Tests for `superserve secrets set|list|delete`."""

    def test_secrets_set(self, runner, deployed_agent):
        """Set a secret on a deployed agent."""
        name, _agent = deployed_agent
        result = runner.invoke(cli, ["secrets", "set", name, "TEST_KEY=test_value"])
        assert result.exit_code == 0, result.output
        assert "Set" in result.output or "set" in result.output.lower()

    def test_secrets_list(self, runner, deployed_agent):
        """Set a secret then list → key appears."""
        name, _agent = deployed_agent
        # Set a secret first
        runner.invoke(cli, ["secrets", "set", name, "MY_SECRET=val123"])

        result = runner.invoke(cli, ["secrets", "list", name])
        assert result.exit_code == 0, result.output
        assert "MY_SECRET" in result.output

    def test_secrets_delete(self, runner, deployed_agent):
        """Set a secret, delete it, verify removed."""
        name, _agent = deployed_agent
        # Set a secret
        runner.invoke(cli, ["secrets", "set", name, "DEL_KEY=todelete"])

        # Delete it
        result = runner.invoke(cli, ["secrets", "delete", name, "DEL_KEY", "-y"])
        assert result.exit_code == 0, result.output
        assert "Deleted" in result.output or "deleted" in result.output.lower()

        # Verify it's gone
        list_result = runner.invoke(cli, ["secrets", "list", name])
        assert "DEL_KEY" not in list_result.output


# ---------------------------------------------------------------------------
# Run Command (requires ANTHROPIC_API_KEY)
# ---------------------------------------------------------------------------


@requires_anthropic
class TestRunCommand:
    """Tests for `superserve run` (one-shot mode via CliRunner)."""

    @pytest.mark.timeout(180)
    def test_run_single_shot(self, runner, deployed_sdk_agent):
        """Run agent with a simple prompt → output contains expected answer."""
        name, _agent = deployed_sdk_agent
        result = runner.invoke(
            cli,
            ["run", name, "What is 2+2? Reply with just the number.", "--single"],
            catch_exceptions=False,
        )
        # Exit code 0 or the streaming completed
        assert "4" in result.output, f"Expected '4' in output: {result.output}"

    @pytest.mark.timeout(180)
    def test_run_json_mode(self, runner, deployed_sdk_agent):
        """Run agent with --json → valid JSON events in output."""
        name, _agent = deployed_sdk_agent
        result = runner.invoke(
            cli,
            ["run", name, "Say hello.", "--single", "--json"],
            catch_exceptions=False,
        )
        # Each line should be valid JSON with event/data keys
        events = []
        for line in result.output.strip().splitlines():
            if line.strip():
                event = json.loads(line)
                # CLI outputs {"type": ..., "data": ...} or {"event": ..., "data": ...}
                assert "type" in event or "event" in event
                assert "data" in event
                events.append(event)
        assert len(events) > 0, "Expected at least one SSE event"
        event_types = {e.get("type") or e.get("event") for e in events}
        assert "message.delta" in event_types or "run.completed" in event_types


# ---------------------------------------------------------------------------
# Session Commands (requires ANTHROPIC_API_KEY for session creation)
# ---------------------------------------------------------------------------


@requires_anthropic
class TestSessionCommands:
    """Tests for `superserve sessions list|end`."""

    @pytest.mark.timeout(180)
    def test_sessions_list(self, runner, deployed_sdk_agent):
        """Create session via API → sessions list shows it."""
        _name, agent = deployed_sdk_agent
        # Create session via direct API
        resp = requests.post(
            f"{E2E_API_URL}/v1/sessions",
            headers={"Authorization": f"Bearer {E2E_API_TOKEN}"},
            json={"agent_id": agent["id"]},
            timeout=120,
        )
        assert resp.status_code in (200, 201), f"Session creation failed: {resp.text}"
        session = resp.json()
        session_id = session["id"]

        try:
            result = runner.invoke(cli, ["sessions", "list", "--json"])
            assert result.exit_code == 0, result.output
            sessions_data = json.loads(result.output)
            session_ids = [s["id"] for s in sessions_data]
            assert session_id in session_ids
        finally:
            # Cleanup: end the session
            requests.post(
                f"{E2E_API_URL}/v1/sessions/{session_id}/end",
                headers={"Authorization": f"Bearer {E2E_API_TOKEN}"},
                timeout=30,
            )

    @pytest.mark.timeout(180)
    def test_sessions_end(self, runner, deployed_sdk_agent):
        """Create session → end via CLI → success."""
        _name, agent = deployed_sdk_agent
        # Create session via direct API
        resp = requests.post(
            f"{E2E_API_URL}/v1/sessions",
            headers={"Authorization": f"Bearer {E2E_API_TOKEN}"},
            json={"agent_id": agent["id"]},
            timeout=120,
        )
        assert resp.status_code in (200, 201), f"Session creation failed: {resp.text}"
        session_id = resp.json()["id"]

        result = runner.invoke(cli, ["sessions", "end", session_id])
        assert result.exit_code == 0, result.output
        assert session_id in result.output or "ended" in result.output.lower()
