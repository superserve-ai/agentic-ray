"""Tests for type models and to_sandbox_info."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from superserve.errors import SandboxError
from superserve.types import (
    EnvStep,
    EnvStepValue,
    NetworkConfig,
    RunStep,
    SandboxInfo,
    SandboxStatus,
    TemplateBuildStatus,
    TemplateStatus,
    UserStep,
    UserStepValue,
    WorkdirStep,
    build_steps_to_api,
    to_build_log_event,
    to_sandbox_info,
    to_template_build_info,
    to_template_info,
)


def _valid_raw() -> dict:
    return {
        "id": "sbx-123",
        "name": "my-sandbox",
        "status": "active",
        "vcpu_count": 2,
        "memory_mib": 1024,
        "created_at": "2026-01-01T12:00:00",
        "timeout_seconds": 600,
        "network": {"allow_out": ["1.2.3.4"], "deny_out": []},
        "metadata": {"key": "value"},
    }


class TestToSandboxInfo:
    def test_valid_response_parses(self) -> None:
        info = to_sandbox_info(_valid_raw())
        assert isinstance(info, SandboxInfo)
        assert info.id == "sbx-123"
        assert info.name == "my-sandbox"
        assert info.status == SandboxStatus.ACTIVE
        assert info.vcpu_count == 2
        assert info.memory_mib == 1024
        assert info.timeout_seconds == 600
        assert info.metadata == {"key": "value"}

    def test_auto_delete_fields_parse(self) -> None:
        raw = _valid_raw()
        raw["auto_delete_seconds"] = 3600
        raw["auto_delete_at"] = "2026-01-01T13:00:00Z"
        info = to_sandbox_info(raw)
        assert info.auto_delete_seconds == 3600
        assert isinstance(info.auto_delete_at, datetime)
        assert info.auto_delete_at.hour == 13
        assert info.network is not None
        assert info.network.allow_out == ["1.2.3.4"]
        assert info.network.deny_out == []

    def test_missing_id_raises(self) -> None:
        raw = _valid_raw()
        del raw["id"]
        with pytest.raises(SandboxError, match="id"):
            to_sandbox_info(raw)

    def test_missing_status_raises(self) -> None:
        raw = _valid_raw()
        del raw["status"]
        with pytest.raises(SandboxError, match="status"):
            to_sandbox_info(raw)

    def test_missing_optional_fields_uses_defaults(self) -> None:
        raw = {
            "id": "sbx-1",
            "status": "active",
            "created_at": "2026-01-01T00:00:00Z",
        }
        info = to_sandbox_info(raw)
        assert info.name == ""
        assert info.vcpu_count == 0
        assert info.memory_mib == 0
        assert info.timeout_seconds is None
        assert info.auto_delete_seconds is None
        assert info.auto_delete_at is None
        assert info.network is None
        assert info.metadata == {}

    def test_created_at_parses_datetime(self) -> None:
        raw = _valid_raw()
        info = to_sandbox_info(raw)
        assert isinstance(info.created_at, datetime)
        assert info.created_at.year == 2026
        assert info.created_at.month == 1

    def test_missing_created_at_raises(self) -> None:
        raw = _valid_raw()
        del raw["created_at"]
        with pytest.raises(SandboxError, match="created_at"):
            to_sandbox_info(raw)

    def test_created_at_parses_z_suffix(self) -> None:
        raw = _valid_raw()
        raw["created_at"] = "2026-01-01T12:00:00Z"
        info = to_sandbox_info(raw)
        assert info.created_at == datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

    def test_created_at_parses_z_suffix_with_fractional(self) -> None:
        raw = _valid_raw()
        raw["created_at"] = "2026-01-01T12:00:00.123456Z"
        info = to_sandbox_info(raw)
        assert info.created_at.tzinfo is not None
        assert info.created_at.microsecond == 123456

    def test_network_config_parses(self) -> None:
        cfg = NetworkConfig(allow_out=["1.1.1.1"], deny_out=None)
        assert cfg.allow_out == ["1.1.1.1"]
        assert cfg.deny_out is None


class TestSandboxStatus:
    def test_all_statuses_exist(self) -> None:
        assert SandboxStatus.STARTING.value == "starting"
        assert SandboxStatus.ACTIVE.value == "active"
        assert SandboxStatus.PAUSING.value == "pausing"
        assert SandboxStatus.PAUSED.value == "paused"
        assert SandboxStatus.RESUMING.value == "resuming"
        assert SandboxStatus.FAILED.value == "failed"
        assert SandboxStatus.DELETED.value == "deleted"

    def test_status_enum_values(self) -> None:
        assert {s.value for s in SandboxStatus} == {
            "starting",
            "active",
            "pausing",
            "paused",
            "resuming",
            "failed",
            "deleted",
        }


class TestToTemplateInfo:
    def test_basic(self) -> None:
        info = to_template_info(
            {
                "id": "t-1",
                "team_id": "team-1",
                "name": "my-env",
                "status": "ready",
                "vcpu": 2,
                "memory_mib": 2048,
                "disk_mib": 4096,
                "size_bytes": 12345,
                "created_at": "2026-01-01T00:00:00Z",
                "built_at": "2026-01-01T00:01:00Z",
            }
        )
        assert info.id == "t-1"
        assert info.name == "my-env"
        assert info.status == TemplateStatus.READY
        assert info.vcpu == 2
        assert info.memory_mib == 2048
        assert info.disk_mib == 4096
        assert info.size_bytes == 12345
        assert isinstance(info.created_at, datetime)
        assert isinstance(info.built_at, datetime)

    def test_optional_fields_absent(self) -> None:
        info = to_template_info(
            {
                "id": "t-1",
                "team_id": "team-1",
                "name": "my-env",
                "status": "building",
                "vcpu": 1,
                "memory_mib": 1024,
                "disk_mib": 4096,
                "created_at": "2026-01-01T00:00:00Z",
            }
        )
        assert info.size_bytes is None
        assert info.built_at is None
        assert info.error_message is None


class TestToTemplateBuildInfo:
    def test_basic(self) -> None:
        b = to_template_build_info(
            {
                "id": "b-1",
                "template_id": "t-1",
                "status": "ready",
                "build_spec_hash": "h",
                "started_at": "2026-01-01T00:00:00Z",
                "finalized_at": "2026-01-01T00:01:00Z",
                "created_at": "2026-01-01T00:00:00Z",
            }
        )
        assert b.id == "b-1"
        assert b.template_id == "t-1"
        assert b.status == TemplateBuildStatus.READY
        assert b.build_spec_hash == "h"


class TestToBuildLogEvent:
    def test_basic(self) -> None:
        ev = to_build_log_event(
            {
                "timestamp": "2026-01-01T00:00:00Z",
                "stream": "stdout",
                "text": "hello",
                "finished": True,
                "status": "ready",
            }
        )
        assert ev.text == "hello"
        assert ev.finished is True
        assert ev.status == "ready"


class TestBuildStepsToApi:
    def test_run(self) -> None:
        out = build_steps_to_api([RunStep(run="echo hello")])
        assert out == [{"run": "echo hello"}]

    def test_env(self) -> None:
        out = build_steps_to_api([EnvStep(env=EnvStepValue(key="DEBUG", value="1"))])
        assert out == [{"env": {"key": "DEBUG", "value": "1"}}]

    def test_workdir(self) -> None:
        out = build_steps_to_api([WorkdirStep(workdir="/app")])
        assert out == [{"workdir": "/app"}]

    def test_user_default_sudo_false(self) -> None:
        out = build_steps_to_api([UserStep(user=UserStepValue(name="appuser"))])
        assert out == [{"user": {"name": "appuser", "sudo": False}}]

    def test_user_sudo_true(self) -> None:
        out = build_steps_to_api(
            [UserStep(user=UserStepValue(name="appuser", sudo=True))]
        )
        assert out == [{"user": {"name": "appuser", "sudo": True}}]
