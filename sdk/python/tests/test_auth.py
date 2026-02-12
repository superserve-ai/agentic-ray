"""Tests for authentication handling."""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from superserve_sdk.auth import (
    SUPERSERVE_API_KEY_ENV,
    AuthProvider,
    Credentials,
    clear_credentials,
    get_api_key,
    load_credentials_from_file,
    save_credentials_to_file,
)


class TestCredentials:
    """Tests for Credentials model."""

    def test_create_credentials(self):
        """Test creating credentials."""
        creds = Credentials(api_key="sk_test_123")

        assert creds.api_key == "sk_test_123"
        assert creds.token_type == "Bearer"

    def test_custom_token_type(self):
        """Test credentials with custom token type."""
        creds = Credentials(api_key="sk_test_123", token_type="Token")

        assert creds.token_type == "Token"


class TestGetApiKey:
    """Tests for get_api_key function."""

    def test_explicit_api_key_takes_priority(self, mock_api_key):
        """Test that explicit api_key parameter takes priority."""
        with patch.dict(os.environ, {SUPERSERVE_API_KEY_ENV: "env_key"}):
            result = get_api_key(api_key=mock_api_key)

        assert result == mock_api_key

    def test_env_var_second_priority(self):
        """Test that environment variable is checked second."""
        env_key = "sk_env_12345"
        with patch.dict(os.environ, {SUPERSERVE_API_KEY_ENV: env_key}, clear=False):
            result = get_api_key()

        assert result == env_key

    def test_credentials_file_third_priority(self, temp_credentials_file, mock_api_key):
        """Test that credentials file is checked third."""
        # Clear env var to ensure file is used
        with patch.dict(os.environ, {}, clear=True):
            result = get_api_key(credentials_path=temp_credentials_file)

        assert result == mock_api_key

    def test_returns_none_when_no_key_found(self, tmp_path):
        """Test that None is returned when no key is found."""
        nonexistent_path = tmp_path / "nonexistent" / "credentials.json"

        with patch.dict(os.environ, {}, clear=True):
            result = get_api_key(credentials_path=nonexistent_path)

        assert result is None

    def test_priority_order(self, temp_credentials_file, mock_api_key):
        """Test the complete priority order."""
        explicit_key = "sk_explicit"
        env_key = "sk_env"

        # All three sources available - explicit wins
        with patch.dict(os.environ, {SUPERSERVE_API_KEY_ENV: env_key}):
            result = get_api_key(
                api_key=explicit_key,
                credentials_path=temp_credentials_file,
            )
        assert result == explicit_key

        # Only env and file - env wins
        with patch.dict(os.environ, {SUPERSERVE_API_KEY_ENV: env_key}):
            result = get_api_key(credentials_path=temp_credentials_file)
        assert result == env_key


class TestLoadCredentialsFromFile:
    """Tests for load_credentials_from_file function."""

    def test_load_valid_credentials(self, temp_credentials_file, mock_api_key):
        """Test loading valid credentials from file."""
        creds = load_credentials_from_file(temp_credentials_file)

        assert creds is not None
        assert creds.api_key == mock_api_key

    def test_load_with_token_key(self, tmp_path):
        """Test loading credentials with 'token' key."""
        creds_file = tmp_path / "creds.json"
        creds_file.write_text(json.dumps({"token": "sk_token_123"}))

        creds = load_credentials_from_file(creds_file)

        assert creds is not None
        assert creds.api_key == "sk_token_123"

    def test_load_with_access_token_key(self, tmp_path):
        """Test loading credentials with 'access_token' key."""
        creds_file = tmp_path / "creds.json"
        creds_file.write_text(json.dumps({"access_token": "sk_access_123"}))

        creds = load_credentials_from_file(creds_file)

        assert creds is not None
        assert creds.api_key == "sk_access_123"

    def test_load_with_custom_token_type(self, tmp_path):
        """Test loading credentials with custom token type."""
        creds_file = tmp_path / "creds.json"
        creds_file.write_text(
            json.dumps(
                {
                    "api_key": "sk_123",
                    "token_type": "Token",
                }
            )
        )

        creds = load_credentials_from_file(creds_file)

        assert creds is not None
        assert creds.token_type == "Token"

    def test_nonexistent_file_returns_none(self, tmp_path):
        """Test that nonexistent file returns None."""
        nonexistent = tmp_path / "nonexistent.json"

        creds = load_credentials_from_file(nonexistent)

        assert creds is None

    def test_invalid_json_returns_none(self, tmp_path):
        """Test that invalid JSON returns None."""
        invalid_file = tmp_path / "invalid.json"
        invalid_file.write_text("not valid json")

        creds = load_credentials_from_file(invalid_file)

        assert creds is None

    def test_missing_key_returns_none(self, tmp_path):
        """Test that file without any key field returns None."""
        creds_file = tmp_path / "empty.json"
        creds_file.write_text(json.dumps({"other_field": "value"}))

        creds = load_credentials_from_file(creds_file)

        assert creds is None


class TestSaveCredentialsToFile:
    """Tests for save_credentials_to_file function."""

    def test_save_credentials(self, tmp_path):
        """Test saving credentials to file."""
        creds_file = tmp_path / ".superserve" / "credentials.json"

        save_credentials_to_file("sk_save_123", path=creds_file)

        assert creds_file.exists()
        data = json.loads(creds_file.read_text())
        assert data["api_key"] == "sk_save_123"
        assert data["token_type"] == "Bearer"

    def test_creates_parent_directory(self, tmp_path):
        """Test that parent directory is created if needed."""
        nested_path = tmp_path / "a" / "b" / "c" / "credentials.json"

        save_credentials_to_file("sk_123", path=nested_path)

        assert nested_path.exists()

    def test_custom_token_type(self, tmp_path):
        """Test saving with custom token type."""
        creds_file = tmp_path / "creds.json"

        save_credentials_to_file("sk_123", path=creds_file, token_type="Token")

        data = json.loads(creds_file.read_text())
        assert data["token_type"] == "Token"

    def test_file_permissions(self, tmp_path):
        """Test that file has restrictive permissions."""
        creds_file = tmp_path / "creds.json"

        save_credentials_to_file("sk_123", path=creds_file)

        # Check file mode (owner read/write only)
        import stat

        mode = creds_file.stat().st_mode
        assert mode & stat.S_IRWXG == 0  # No group permissions
        assert mode & stat.S_IRWXO == 0  # No other permissions

    def test_overwrites_existing(self, tmp_path):
        """Test that existing file is overwritten."""
        creds_file = tmp_path / "creds.json"
        creds_file.write_text(json.dumps({"api_key": "old_key"}))

        save_credentials_to_file("new_key", path=creds_file)

        data = json.loads(creds_file.read_text())
        assert data["api_key"] == "new_key"


class TestClearCredentials:
    """Tests for clear_credentials function."""

    def test_clear_existing_credentials(self, temp_credentials_file):
        """Test clearing existing credentials."""
        assert temp_credentials_file.exists()

        result = clear_credentials(path=temp_credentials_file)

        assert result is True
        assert not temp_credentials_file.exists()

    def test_clear_nonexistent_returns_false(self, tmp_path):
        """Test clearing nonexistent file returns False."""
        nonexistent = tmp_path / "nonexistent.json"

        result = clear_credentials(path=nonexistent)

        assert result is False


class TestAuthProvider:
    """Tests for AuthProvider class."""

    def test_explicit_api_key(self, mock_api_key):
        """Test provider with explicit API key."""
        provider = AuthProvider(api_key=mock_api_key)

        assert provider.api_key == mock_api_key

    def test_from_env_var(self):
        """Test provider loading from environment variable."""
        env_key = "sk_env_provider"
        with patch.dict(os.environ, {SUPERSERVE_API_KEY_ENV: env_key}):
            provider = AuthProvider()
            assert provider.api_key == env_key

    def test_from_credentials_file(self, temp_credentials_file, mock_api_key):
        """Test provider loading from credentials file."""
        with patch.dict(os.environ, {}, clear=True):
            provider = AuthProvider(credentials_path=temp_credentials_file)
            assert provider.api_key == mock_api_key

    def test_get_headers(self, mock_api_key):
        """Test getting authorization headers."""
        provider = AuthProvider(api_key=mock_api_key)

        headers = provider.get_headers()

        assert headers == {"Authorization": f"Bearer {mock_api_key}"}

    def test_get_headers_raises_without_key(self, tmp_path):
        """Test that get_headers raises ValueError without key."""
        nonexistent = tmp_path / "nonexistent.json"

        with patch.dict(os.environ, {}, clear=True):
            provider = AuthProvider(credentials_path=nonexistent)

            with pytest.raises(ValueError) as exc_info:
                provider.get_headers()

            assert "No API key found" in str(exc_info.value)

    def test_is_authenticated(self, mock_api_key):
        """Test is_authenticated method."""
        provider = AuthProvider(api_key=mock_api_key)

        assert provider.is_authenticated() is True

    def test_is_not_authenticated(self, tmp_path):
        """Test is_authenticated when no key available."""
        nonexistent = tmp_path / "nonexistent.json"

        with patch.dict(os.environ, {}, clear=True):
            provider = AuthProvider(credentials_path=nonexistent)

            assert provider.is_authenticated() is False

    def test_refresh_clears_cache(self, mock_api_key):
        """Test that refresh clears the cached key."""
        provider = AuthProvider(api_key=mock_api_key)

        # Access key to cache it
        _ = provider.api_key
        assert provider._resolved_key is not None

        # Refresh should clear cache
        provider.refresh()
        assert provider._resolved_key is None

    def test_caching(self, mock_api_key):
        """Test that API key is cached after first access."""
        provider = AuthProvider(api_key=mock_api_key)

        # First access
        key1 = provider.api_key
        # Second access should use cached value
        key2 = provider.api_key

        assert key1 == key2 == mock_api_key
        assert provider._resolved_key == mock_api_key
