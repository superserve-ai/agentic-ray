"""Abstract sandbox backend protocol and environment detection.

This module provides a pluggable backend system for code execution sandboxes,
enabling the same API to work across different environments:
- Local development with Docker
- Kubernetes clusters (Anyscale, GKE, etc.) with agent-sandbox
"""

import logging
import os
from abc import ABC, abstractmethod

from .types import (
    CleanupError,
    CleanupResult,
    ExecutionError,
    ExecutionResult,
    SessionStats,
    UploadError,
    UploadResult,
)

logger = logging.getLogger(__name__)


class SandboxBackend(ABC):
    """Abstract base class for sandbox execution backends.

    All sandbox backends must implement this interface to provide
    code execution, shell execution, file upload, and lifecycle management.
    """

    def __init__(
        self,
        session_id: str,
        image: str,
        dockerfile: str | None = None,
        environment: dict[str, str] | None = None,
        volumes: dict[str, dict[str, str]] | None = None,
        mcp_allowlist: list[str] | None = None,
    ):
        self.session_id = session_id
        self.image = image
        self.dockerfile = dockerfile
        self.environment = environment or {}
        self.volumes = volumes or {}
        self.mcp_allowlist = mcp_allowlist or []

    @abstractmethod
    async def execute(
        self, code: str, timeout: int
    ) -> ExecutionResult | ExecutionError:
        """Execute Python code in the sandbox.

        Args:
            code: Python code to execute
            timeout: Execution timeout in seconds

        Returns:
            Execution result with stdout, stderr, status
        """
        ...

    @abstractmethod
    async def execute_shell(
        self, command: str, timeout: int
    ) -> ExecutionResult | ExecutionError:
        """Execute shell command in the sandbox.

        Args:
            command: Shell command to execute
            timeout: Execution timeout in seconds

        Returns:
            Execution result with stdout, stderr, status
        """
        ...

    @abstractmethod
    def upload_file(self, path: str, content: bytes) -> UploadResult | UploadError:
        """Upload file to the sandbox.

        Args:
            path: Destination path in sandbox
            content: File content as bytes

        Returns:
            Upload result
        """
        ...

    @abstractmethod
    def get_stats(self) -> SessionStats:
        """Get session statistics.

        Returns:
            Session statistics
        """
        ...

    @abstractmethod
    def cleanup(self) -> CleanupResult | CleanupError:
        """Cleanup sandbox resources.

        Returns:
            Cleanup result
        """
        ...


def is_kubernetes_environment() -> bool:
    """Detect if running inside a Kubernetes cluster.

    Checks for the presence of Kubernetes service account credentials
    which are automatically mounted in pods.
    """
    return os.environ.get("KUBERNETES_SERVICE_HOST") is not None or os.path.exists(
        "/var/run/secrets/kubernetes.io/serviceaccount/token"
    )


def is_docker_available() -> bool:
    """Check if Docker is available and running."""
    try:
        import docker

        # Try to connect without loading credential stores
        base_url = os.environ.get("DOCKER_HOST", "unix://var/run/docker.sock")
        client = docker.DockerClient(base_url=base_url)
        client.ping()
        client.close()
        return True
    except Exception as e:
        logger.debug(f"Docker not available: {e}")
        return False


def get_backend_type() -> str:
    """Detect the appropriate sandbox backend for the current environment.

    Returns:
        Backend type: "kubernetes", "docker", or "subprocess"
    """
    # Check for explicit override
    backend_override = os.environ.get("RAYAI_SANDBOX_BACKEND")
    if backend_override:
        logger.info(
            f"Using sandbox backend from RAYAI_SANDBOX_BACKEND: {backend_override}"
        )
        return backend_override

    # Auto-detect environment
    if is_kubernetes_environment():
        logger.info("Detected Kubernetes environment, using kubernetes backend")
        return "kubernetes"

    if is_docker_available():
        logger.info("Docker available, using docker backend")
        return "docker"

    logger.warning("No container runtime available, falling back to subprocess backend")
    return "subprocess"
