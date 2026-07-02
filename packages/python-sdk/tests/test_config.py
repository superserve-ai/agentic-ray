"""Tests for config resolution."""

from __future__ import annotations

import pytest
from superserve._config import (
    DEFAULT_BASE_URL,
    DEFAULT_SANDBOX_HOST,
    MAX_PREVIEW_PORT,
    MIN_PREVIEW_PORT,
    _derive_sandbox_host,
    _region_from_api_key,
    data_plane_target,
    preview_url,
    resolve_config,
)
from superserve.errors import AuthenticationError, ValidationError


class TestResolveConfig:
    def test_explicit_api_key_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        cfg = resolve_config(api_key="ss_live_arg")
        assert cfg.api_key == "ss_live_arg"

    def test_env_var_used_when_no_arg(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        cfg = resolve_config()
        assert cfg.api_key == "ss_live_env"

    def test_missing_raises_authentication_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("SUPERSERVE_API_KEY", raising=False)
        with pytest.raises(AuthenticationError):
            resolve_config()

    def test_explicit_base_url_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        monkeypatch.setenv("SUPERSERVE_BASE_URL", "https://env.example.com")
        cfg = resolve_config(base_url="https://arg.example.com")
        assert cfg.base_url == "https://arg.example.com"

    def test_env_base_url_used_when_no_arg(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        monkeypatch.setenv("SUPERSERVE_BASE_URL", "https://env.example.com")
        cfg = resolve_config()
        assert cfg.base_url == "https://env.example.com"

    def test_default_base_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_env")
        monkeypatch.delenv("SUPERSERVE_BASE_URL", raising=False)
        cfg = resolve_config()
        assert cfg.base_url == DEFAULT_BASE_URL


class TestRegionDerivation:
    @pytest.fixture(autouse=True)
    def _no_base_url_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("SUPERSERVE_BASE_URL", raising=False)

    def test_known_region_key_resolves_mapped_endpoints(self) -> None:
        cfg = resolve_config(api_key="ss_live_use_abc123")
        assert cfg.base_url == "https://api.superserve.ai"
        assert cfg.sandbox_host == "sandbox.superserve.ai"

    def test_unknown_region_falls_back_to_default(self) -> None:
        # `usw` won't enter the known-regions map until its DNS is live.
        cfg = resolve_config(api_key="ss_live_usw_abc123")
        assert cfg.base_url == DEFAULT_BASE_URL
        assert cfg.sandbox_host == DEFAULT_SANDBOX_HOST

    def test_legacy_key_uses_default(self) -> None:
        cfg = resolve_config(api_key="ss_live_a1B2c3D4")
        assert cfg.base_url == DEFAULT_BASE_URL
        assert cfg.sandbox_host == DEFAULT_SANDBOX_HOST

    def test_legacy_key_with_underscore_collision_uses_default(self) -> None:
        # Legacy base64url random parts may contain `_`, so this key parses
        # as region "abc123" — not in the map, so defaults win, which is
        # correct for all legacy keys (they are all us-east).
        cfg = resolve_config(api_key="ss_live_abc123_def456")
        assert cfg.base_url == DEFAULT_BASE_URL
        assert cfg.sandbox_host == DEFAULT_SANDBOX_HOST

    def test_explicit_base_url_beats_region(self) -> None:
        cfg = resolve_config(
            api_key="ss_live_use_abc123", base_url="https://arg.example.com"
        )
        assert cfg.base_url == "https://arg.example.com"
        assert cfg.sandbox_host == DEFAULT_SANDBOX_HOST

    def test_env_base_url_beats_region(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_BASE_URL", "https://env.example.com")
        cfg = resolve_config(api_key="ss_live_use_abc123")
        assert cfg.base_url == "https://env.example.com"


class TestRegionFromApiKey:
    @pytest.mark.parametrize(
        ("key", "region"),
        [
            ("ss_live_use_abc123", "use"),
            ("ss_live_usw_abc123", "usw"),
            ("ss_live_a_b", "a"),
            ("ss_live_" + "a" * 17 + "_rest", "a" * 17),
        ],
    )
    def test_extracts_valid_region_tokens(self, key: str, region: str) -> None:
        assert _region_from_api_key(key) == region

    @pytest.mark.parametrize(
        "key",
        [
            "ss_live_a1B2c3D4",  # legacy: no second segment
            "ss_live_USE_abc",  # uppercase is not a region token
            "ss_live_us-e_abc",  # non-alphanumeric
            "ss_live_" + "a" * 18 + "_rest",  # too long
            "ss_live_use_",  # nothing after the region
            "ss_live__abc",  # empty region
            "ss_test_use_abc",  # wrong prefix
            "ss_live_",
            "",
            "not a key",
        ],
    )
    def test_returns_none_for_legacy_or_weird_keys(self, key: str) -> None:
        assert _region_from_api_key(key) is None


class TestDeriveSandboxHost:
    def test_production(self) -> None:
        assert _derive_sandbox_host("https://api.superserve.ai") == DEFAULT_SANDBOX_HOST

    def test_staging(self) -> None:
        assert (
            _derive_sandbox_host("https://api-staging.superserve.ai")
            == "staging-sandbox.superserve.ai"
        )

    def test_other(self) -> None:
        assert (
            _derive_sandbox_host("https://custom.example.com") == DEFAULT_SANDBOX_HOST
        )

    def test_malformed_url(self) -> None:
        # Should fall back to default
        assert _derive_sandbox_host("not a url") == DEFAULT_SANDBOX_HOST


class TestDataPlaneTarget:
    def test_shared_host_on_prod(self) -> None:
        target = data_plane_target("abc-123", "sandbox.superserve.ai")
        assert target.url == "https://sandbox.superserve.ai"
        assert target.headers["X-Superserve-Sandbox-Id"] == "abc-123"

    def test_shared_host_on_staging(self) -> None:
        target = data_plane_target("xyz", "staging-sandbox.superserve.ai")
        assert target.url == "https://staging-sandbox.superserve.ai"
        assert target.headers["X-Superserve-Sandbox-Id"] == "xyz"

    def test_falls_back_to_subdomain_on_unsupported_host(self) -> None:
        target = data_plane_target("abc", "self-hosted.example.org")
        assert target.url == "https://boxd-abc.self-hosted.example.org"
        assert target.headers == {}

    def test_matches_supported_hosts_case_insensitively(self) -> None:
        target = data_plane_target("abc", "Sandbox.SuperServe.AI")
        assert target.url == "https://sandbox.superserve.ai"
        assert target.headers["X-Superserve-Sandbox-Id"] == "abc"


class TestPreviewUrl:
    def test_pins_port_range_to_contract(self) -> None:
        # Drift guard: the console and TypeScript SDK mirror these bounds. Keep
        # all three in sync — this pin makes one-sided drift fail CI.
        assert MIN_PREVIEW_PORT == 1024
        assert MAX_PREVIEW_PORT == 65535

    def test_builds_subdomain_url_for_port(self) -> None:
        assert (
            preview_url("abc-123", "sandbox.superserve.ai", 3000)
            == "https://3000-abc-123.sandbox.superserve.ai"
        )

    def test_uses_subdomain_form_even_on_shared_hosts(self) -> None:
        # A browser opening the URL can't send the routing header, so preview
        # URLs never use the shared-host origin.
        assert (
            preview_url("xyz", "staging-sandbox.superserve.ai", 8080)
            == "https://8080-xyz.staging-sandbox.superserve.ai"
        )

    def test_accepts_boundary_ports(self) -> None:
        assert preview_url("a", "h", 1024) == "https://1024-a.h"
        assert preview_url("a", "h", 65535) == "https://65535-a.h"

    @pytest.mark.parametrize("port", [80, 0, 1023])
    def test_rejects_privileged_ports(self, port: int) -> None:
        with pytest.raises(ValidationError):
            preview_url("a", "h", port)

    def test_rejects_out_of_range_ports(self) -> None:
        with pytest.raises(ValidationError):
            preview_url("a", "h", 70000)

    @pytest.mark.parametrize("port", [3000.5, True, "3000"])
    def test_rejects_non_integer_ports(self, port: object) -> None:
        with pytest.raises(ValidationError):
            preview_url("a", "h", port)  # type: ignore[arg-type]
