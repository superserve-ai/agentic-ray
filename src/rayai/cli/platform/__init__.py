"""RayAI Platform API client for cloud projects."""

from .auth import clear_credentials, get_credentials, is_authenticated, save_credentials
from .client import PlatformAPIError, PlatformClient
from .config import CREDENTIALS_FILE, PLATFORM_API_URL
from .packaging import package_project
from .types import (
    AgentManifest,
    Credentials,
    DeviceCodeResponse,
    LogEntry,
    ProjectManifest,
    ProjectResponse,
)

__all__ = [
    # Auth
    "save_credentials",
    "get_credentials",
    "clear_credentials",
    "is_authenticated",
    # Client
    "PlatformClient",
    "PlatformAPIError",
    # Config
    "PLATFORM_API_URL",
    "CREDENTIALS_FILE",
    # Packaging
    "package_project",
    # Types
    "Credentials",
    "AgentManifest",
    "ProjectManifest",
    "ProjectResponse",
    "DeviceCodeResponse",
    "LogEntry",
]
