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


# A realistic 32-char base64url random tail, matching the length every
# ``ss_live_`` key (legacy or region-tagged) is minted with. Test keys are
# built from this so the exact-length anchor in `_REGION_KEY_RE` is
# actually exercised instead of trivially failing on a too-short fixture.
_TAIL = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
assert len(_TAIL) == 32


class TestRegionDerivation:
    @pytest.fixture(autouse=True)
    def _no_base_url_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("SUPERSERVE_BASE_URL", raising=False)

    def test_known_region_key_resolves_mapped_endpoints(self) -> None:
        cfg = resolve_config(api_key=f"ss_live_use_{_TAIL}")
        assert cfg.base_url == "https://api.superserve.ai"
        assert cfg.sandbox_host == "sandbox.superserve.ai"

    def test_usw_region_key_resolves_mapped_endpoints(self) -> None:
        cfg = resolve_config(api_key=f"ss_live_usw_{_TAIL}")
        assert cfg.base_url == "https://api-usw.superserve.ai"
        assert cfg.sandbox_host == "usw-sandbox.superserve.ai"

    def test_unconfigured_region_falls_back_to_default(self) -> None:
        # A syntactically valid region token that isn't in _KNOWN_REGIONS.
        cfg = resolve_config(api_key=f"ss_live_apac_{_TAIL}")
        assert cfg.base_url == DEFAULT_BASE_URL
        assert cfg.sandbox_host == DEFAULT_SANDBOX_HOST

    def test_legacy_key_uses_default(self) -> None:
        cfg = resolve_config(api_key=f"ss_live_{_TAIL}")
        assert cfg.base_url == DEFAULT_BASE_URL
        assert cfg.sandbox_host == DEFAULT_SANDBOX_HOST

    def test_legacy_key_whose_tail_starts_like_a_region_uses_default(self) -> None:
        # A legacy key's random tail is exactly 32 chars, same as a real
        # key's tail. Even when it happens to start with "usw_", there's no
        # length left over for a genuine `<region>_<32-char-tail>` — so it
        # can never be misparsed as region-tagged, regardless of what's in
        # `_KNOWN_REGIONS`. Correct for every legacy key (they are all
        # us-east).
        cfg = resolve_config(api_key=f"ss_live_usw_{_TAIL[:28]}")
        assert cfg.base_url == DEFAULT_BASE_URL
        assert cfg.sandbox_host == DEFAULT_SANDBOX_HOST

    def test_explicit_base_url_beats_region(self) -> None:
        cfg = resolve_config(
            api_key=f"ss_live_use_{_TAIL}", base_url="https://arg.example.com"
        )
        assert cfg.base_url == "https://arg.example.com"
        assert cfg.sandbox_host == DEFAULT_SANDBOX_HOST

    def test_env_base_url_beats_region(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUPERSERVE_BASE_URL", "https://env.example.com")
        cfg = resolve_config(api_key=f"ss_live_use_{_TAIL}")
        assert cfg.base_url == "https://env.example.com"

    def test_empty_env_base_url_is_unset(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A whitespace-only override must not shadow region derivation.
        monkeypatch.setenv("SUPERSERVE_BASE_URL", "   ")
        cfg = resolve_config(api_key=f"ss_live_usw_{_TAIL}")
        assert cfg.base_url == "https://api-usw.superserve.ai"
        assert cfg.sandbox_host == "usw-sandbox.superserve.ai"

    def test_empty_explicit_base_url_is_unset(self) -> None:
        cfg = resolve_config(api_key=f"ss_live_use_{_TAIL}", base_url="")
        assert cfg.base_url == "https://api.superserve.ai"
        assert cfg.sandbox_host == "sandbox.superserve.ai"

    def test_region_key_sourced_from_env_var(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUPERSERVE_API_KEY", f"ss_live_use_{_TAIL}")
        cfg = resolve_config()
        assert cfg.base_url == "https://api.superserve.ai"
        assert cfg.sandbox_host == "sandbox.superserve.ai"


class TestRegionFromApiKey:
    @pytest.mark.parametrize(
        ("key", "region"),
        [
            (f"ss_live_use_{_TAIL}", "use"),
            (f"ss_live_usw_{_TAIL}", "usw"),
            (f"ss_live_a_{_TAIL}", "a"),
            ("ss_live_" + "a" * 17 + "_" + _TAIL, "a" * 17),
        ],
    )
    def test_extracts_valid_region_tokens(self, key: str, region: str) -> None:
        assert _region_from_api_key(key) == region

    @pytest.mark.parametrize(
        "key",
        [
            f"ss_live_{_TAIL}",  # legacy: no region segment
            f"ss_live_usw_{_TAIL[:28]}",  # legacy tail that starts like "usw_"
            f"ss_live_USE_{_TAIL}",  # uppercase is not a region token
            f"ss_live_us-e_{_TAIL}",  # non-alphanumeric
            "ss_live_" + "a" * 18 + "_" + _TAIL,  # region too long
            f"ss_live_use_{_TAIL[:31]}",  # tail one char short of 32
            f"ss_live_use_{_TAIL}X",  # tail one char over 32
            "ss_live_use_",  # nothing after the region
            f"ss_live__{_TAIL}",  # empty region
            "ss_test_use_" + _TAIL,  # wrong prefix
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

    def test_usw(self) -> None:
        assert (
            _derive_sandbox_host("https://api-usw.superserve.ai")
            == "usw-sandbox.superserve.ai"
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
