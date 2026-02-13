"""Tests for client initialization and configuration."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from superserve_sdk.client import (
    DEFAULT_BASE_URL,
    DEFAULT_TIMEOUT,
    USER_AGENT,
    Superserve,
)


class TestSuperserveInit:
    """Tests for Superserve client initialization."""

    def test_default_configuration(self):
        """Test client with default configuration."""
        with patch.dict(os.environ, {"SUPERSERVE_API_KEY": "sk_test"}):
            client = Superserve()

        assert client._base_url == DEFAULT_BASE_URL.rstrip("/")
        assert client._timeout == DEFAULT_TIMEOUT

    def test_custom_base_url(self):
        """Test client with custom base URL."""
        client = Superserve(
            api_key="sk_test",
            base_url="https://custom.api.com/",
        )

        # Should strip trailing slash
        assert client._base_url == "https://custom.api.com"

    def test_custom_timeout(self):
        """Test client with custom timeout."""
        client = Superserve(api_key="sk_test", timeout=60.0)

        assert client._timeout == 60.0

    def test_explicit_api_key(self):
        """Test client with explicit API key."""
        client = Superserve(api_key="sk_explicit_123")

        assert client._auth._api_key == "sk_explicit_123"

    def test_credentials_path(self, temp_credentials_file):
        """Test client with custom credentials path."""
        with patch.dict(os.environ, {}, clear=True):
            client = Superserve(credentials_path=temp_credentials_file)

        assert client._auth._credentials_path == temp_credentials_file

    def test_client_not_initialized_before_use(self):
        """Test that HTTP client is not initialized until first use."""
        client = Superserve(api_key="sk_test")

        assert client._client is None


class TestSuperserveContextManager:
    """Tests for Superserve async context manager."""

    @pytest.mark.asyncio
    async def test_async_context_manager(self):
        """Test async context manager initializes and closes client."""
        async with Superserve(api_key="sk_test") as client:
            assert client._client is not None

        assert client._client is None

    @pytest.mark.asyncio
    async def test_ensure_client(self):
        """Test _ensure_client creates client."""
        client = Superserve(api_key="sk_test")

        assert client._client is None

        http_client = await client._ensure_client()

        assert http_client is not None
        assert client._client is http_client

        # Cleanup
        await client.close()

    @pytest.mark.asyncio
    async def test_close_client(self):
        """Test closing the client."""
        client = Superserve(api_key="sk_test")
        await client._ensure_client()

        assert client._client is not None

        await client.close()

        assert client._client is None

    @pytest.mark.asyncio
    async def test_close_without_init(self):
        """Test closing client that was never initialized."""
        client = Superserve(api_key="sk_test")

        # Should not raise
        await client.close()

        assert client._client is None


class TestSuperserveHeaders:
    """Tests for request headers."""

    def test_get_headers_returns_auth(self):
        """Test that _get_headers returns authorization header."""
        client = Superserve(api_key="sk_test_123")

        headers = client._get_headers()

        assert headers == {"Authorization": "Bearer sk_test_123"}

    def test_get_headers_raises_without_key(self, tmp_path):
        """Test that _get_headers raises without API key."""
        nonexistent = tmp_path / "nonexistent.json"

        with patch.dict(os.environ, {}, clear=True):
            client = Superserve(credentials_path=nonexistent)

            with pytest.raises(ValueError) as exc_info:
                client._get_headers()

            assert "No API key found" in str(exc_info.value)


class TestClientConfiguration:
    """Tests for client HTTP configuration."""

    @pytest.mark.asyncio
    async def test_client_base_url(self):
        """Test that HTTP client uses correct base URL."""
        async with Superserve(
            api_key="sk_test",
            base_url="https://custom.api.com",
        ) as client:
            # httpx adds trailing slash to base_url
            assert str(client._client.base_url).rstrip("/") == "https://custom.api.com/v1"

    @pytest.mark.asyncio
    async def test_client_timeout(self):
        """Test that HTTP client uses correct timeout."""
        async with Superserve(api_key="sk_test", timeout=45.0) as client:
            assert client._client.timeout.connect == 45.0

    @pytest.mark.asyncio
    async def test_client_user_agent(self):
        """Test that HTTP client includes User-Agent header."""
        async with Superserve(api_key="sk_test") as client:
            assert client._client.headers["User-Agent"] == USER_AGENT

    @pytest.mark.asyncio
    async def test_client_content_type(self):
        """Test that HTTP client includes Content-Type header."""
        async with Superserve(api_key="sk_test") as client:
            assert client._client.headers["Content-Type"] == "application/json"


class TestUserAgentConstant:
    """Tests for USER_AGENT constant."""

    def test_user_agent_format(self):
        """Test USER_AGENT has correct format."""
        assert USER_AGENT.startswith("superserve-sdk-python/")
        assert "0.1.0" in USER_AGENT


class TestDefaultConstants:
    """Tests for default configuration constants."""

    def test_default_base_url(self):
        """Test default base URL."""
        assert DEFAULT_BASE_URL == "https://api.superserve.ai"

    def test_default_timeout(self):
        """Test default timeout."""
        assert DEFAULT_TIMEOUT == 30.0
