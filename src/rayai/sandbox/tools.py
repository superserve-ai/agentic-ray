"""Ray remote tools for code execution"""

import logging
import time
import uuid
from typing import cast

import ray

from .backend import get_backend_type
from .config import DEFAULT_IMAGE, DEFAULT_TIMEOUT
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

# Namespace for all sandbox actors
ACTOR_NAMESPACE = "sandbox"

# Cache the backend type to avoid repeated detection
_backend_type: str | None = None


def _get_executor_class():
    """Get the appropriate executor class based on environment."""
    global _backend_type

    if _backend_type is None:
        _backend_type = get_backend_type()

    if _backend_type == "kubernetes":
        from .kubernetes_executor import KubernetesSandboxExecutor

        return KubernetesSandboxExecutor
    elif _backend_type == "docker":
        from .executor import CodeInterpreterExecutor

        return CodeInterpreterExecutor
    else:
        # Fallback to Docker executor (will fail gracefully if Docker unavailable)
        from .executor import CodeInterpreterExecutor

        logger.warning(
            f"Unknown backend type '{_backend_type}', falling back to Docker executor"
        )
        return CodeInterpreterExecutor


def _get_or_create_executor(
    session_id: str,
    image: str = DEFAULT_IMAGE,
    dockerfile: str | None = None,
    environment: dict[str, str] | None = None,
    volumes: dict[str, dict[str, str]] | None = None,
    mcp_allowlist: list[str] | None = None,
) -> ray.actor.ActorHandle:
    """Get existing executor or create new one for session.

    Automatically selects the appropriate executor backend based on environment:
    - Kubernetes: Uses agent-sandbox SDK (for Anyscale, GKE, etc.)
    - Docker: Uses Docker containers (for local development)
    """
    actor_name = f"code-executor-{session_id}"

    try:
        # Try to get existing actor
        executor = ray.get_actor(actor_name, namespace=ACTOR_NAMESPACE)
        logger.debug(f"Found existing executor for session {session_id}")
        return cast(ray.actor.ActorHandle, executor)
    except ValueError:
        # Actor doesn't exist, create new one with appropriate backend
        ExecutorClass = _get_executor_class()
        executor_name = getattr(
            ExecutorClass, "__ray_actor_class__", ExecutorClass
        ).__name__
        logger.info(f"Creating new {executor_name} executor for session {session_id}")

        executor = ExecutorClass.options(
            name=actor_name,
            namespace=ACTOR_NAMESPACE,
            lifetime="detached",
        ).remote(
            session_id=session_id,
            image=image,
            dockerfile=dockerfile,
            environment=environment,
            volumes=volumes,
            mcp_allowlist=mcp_allowlist,
        )
        return cast(ray.actor.ActorHandle, executor)


@ray.remote
def execute_code(
    code: str,
    session_id: str | None = None,
    image: str = DEFAULT_IMAGE,
    dockerfile: str | None = None,
    environment: dict[str, str] | None = None,
    volumes: dict[str, dict[str, str]] | None = None,
    mcp_allowlist: list[str] | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> ExecutionResult | ExecutionError:
    """
    Execute Python code in isolated Docker container.

    IMPORTANT: Network access is DISABLED. The container has no internet access.
    - All required packages must be pre-installed in the Docker image
    - External data access is only possible through MCP servers
    - Cannot make HTTP requests, pip install, or access external services

    Args:
        code: Python code to execute
        session_id: Session identifier for persistence (optional, auto-generated if not provided)
        image: Docker image to use (default: python:3.11-slim)
        dockerfile: Custom Dockerfile string (optional, overrides image)
        environment: Environment variables for container
        volumes: Volume mounts for container. Format:
            {'/host/path': {'bind': '/container/path', 'mode': 'ro'}}
        mcp_allowlist: List of allowed MCP server URLs (e.g., ['http://localhost:8265/mcp'])
        timeout: Execution timeout in seconds

    Returns:
        Execution result with stdout, stderr, status

    Example:
        >>> result = ray.get(execute_code.remote("print('Hello!')"))
        >>> print(result["stdout"])
        Hello!

        >>> # With session persistence
        >>> ray.get(execute_code.remote("x = 42", session_id="my-session"))
        >>> result = ray.get(execute_code.remote("print(x)", session_id="my-session"))
        >>> print(result["stdout"])
        42

        >>> # With volume mounts
        >>> volumes = {'/host/data': {'bind': '/mnt/data', 'mode': 'ro'}}
        >>> ray.get(execute_code.remote("import os; print(os.listdir('/mnt/data'))",
        ...                              session_id="my-session", volumes=volumes))
    """
    # Generate session_id if not provided
    if session_id is None:
        session_id = f"session-{uuid.uuid4().hex[:8]}-{int(time.time())}"
        logger.info(f"Auto-generated session_id: {session_id}")
    else:
        logger.info(f"Using provided session_id: {session_id}")

    # Get or create executor for session
    executor = _get_or_create_executor(
        session_id, image, dockerfile, environment, volumes, mcp_allowlist
    )

    # Execute code
    logger.info(f"Executing code in session {session_id}: {code[:50]}...")
    result: ExecutionResult | ExecutionError = ray.get(
        executor.execute.remote(code, timeout)
    )

    return result


@ray.remote
def execute_shell(
    command: str,
    session_id: str | None = None,
    image: str = DEFAULT_IMAGE,
    dockerfile: str | None = None,
    environment: dict[str, str] | None = None,
    volumes: dict[str, dict[str, str]] | None = None,
    mcp_allowlist: list[str] | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> ExecutionResult | ExecutionError:
    """
    Execute shell command in isolated Docker container.

    IMPORTANT: Network access is DISABLED. The container has no internet access.
    - Cannot use pip install, apt-get, curl, wget, or other network tools
    - All required packages must be pre-installed in the Docker image
    - External data access is only possible through MCP servers
    - Cannot access external services or download files from the internet

    Args:
        command: Shell command to execute
        session_id: Session identifier for persistence (optional, auto-generated if not provided)
        image: Docker image to use (default: python:3.12-slim)
        dockerfile: Custom Dockerfile string (optional, overrides image)
        environment: Environment variables for container
        volumes: Volume mounts for container. Format:
            {'/host/path': {'bind': '/container/path', 'mode': 'ro'}}
        mcp_allowlist: List of allowed MCP server URLs (e.g., ['http://localhost:8265/mcp'])
        timeout: Execution timeout in seconds

    Returns:
        Execution result with stdout, stderr, status

    Example:
        >>> # List files
        >>> result = ray.get(execute_shell.remote("ls -la /mnt"))
        >>> print(result["stdout"])

        >>> # Install package and use in Python (same session)
        >>> ray.get(execute_shell.remote("pip install numpy", session_id="my-session"))
        >>> result = ray.get(execute_code.remote(
        ...     "import numpy; print(numpy.__version__)",
        ...     session_id="my-session"
        ... ))

        >>> # Inspect dataset
        >>> ray.get(execute_shell.remote("wc -l /mnt/datasets/*.csv", session_id="my-session"))
    """
    # Generate session_id if not provided
    if session_id is None:
        session_id = f"session-{uuid.uuid4().hex[:8]}-{int(time.time())}"
        logger.info(f"Auto-generated session_id: {session_id}")
    else:
        logger.info(f"Using provided session_id: {session_id}")

    # Get or create executor for session
    executor = _get_or_create_executor(
        session_id, image, dockerfile, environment, volumes, mcp_allowlist
    )

    # Execute shell command
    logger.info(f"Executing shell command in session {session_id}: {command[:50]}...")
    result: ExecutionResult | ExecutionError = ray.get(
        executor.execute_shell.remote(command, timeout)
    )

    return result


@ray.remote
def upload_file(
    path: str,
    content: bytes,
    session_id: str,
) -> UploadResult | UploadError:
    """
    Upload file to session container.

    Args:
        path: Destination path in container (e.g., "/tmp/data.csv")
        content: File content as bytes
        session_id: Session identifier

    Returns:
        Upload result

    Example:
        >>> ray.get(execute_code.remote("x = 1", session_id="my-session"))
        >>> data = b"col1,col2\\n1,2\\n3,4"
        >>> ray.get(upload_file.remote("/tmp/data.csv", data, session_id="my-session"))
        >>> result = ray.get(execute_code.remote(
        ...     "with open('/tmp/data.csv') as f: print(f.read())",
        ...     session_id="my-session"
        ... ))
    """
    try:
        executor = ray.get_actor(
            f"code-executor-{session_id}", namespace=ACTOR_NAMESPACE
        )
    except ValueError as err:
        raise ValueError(
            f"Session {session_id} not found. " "Execute code first to create session."
        ) from err

    logger.info(f"Uploading file to {path} in session {session_id}")
    result: UploadResult | UploadError = ray.get(
        executor.upload_file.remote(path, content)
    )

    return result


@ray.remote
def get_session_stats(session_id: str) -> SessionStats:
    """
    Get statistics for a session.

    Args:
        session_id: Session identifier

    Returns:
        Session statistics

    Example:
        >>> stats = ray.get(get_session_stats.remote("my-session"))
        >>> print(f"Executions: {stats['execution_count']}")
    """
    try:
        executor = ray.get_actor(
            f"code-executor-{session_id}", namespace=ACTOR_NAMESPACE
        )
    except ValueError as err:
        raise ValueError(f"Session {session_id} not found") from err

    stats: SessionStats = ray.get(executor.get_stats.remote())
    return stats


@ray.remote
def cleanup_session(session_id: str) -> CleanupResult | CleanupError:
    """
    Cleanup session and remove container.

    Args:
        session_id: Session identifier

    Returns:
        Cleanup result

    Example:
        >>> ray.get(cleanup_session.remote("my-session"))
        {"status": "success", "session_id": "my-session"}
    """
    try:
        executor = ray.get_actor(
            f"code-executor-{session_id}", namespace=ACTOR_NAMESPACE
        )
    except ValueError:
        return CleanupError(
            status="error",
            error=f"Session {session_id} not found",
            session_id=session_id,
        )

    logger.info(f"Cleaning up session {session_id}")

    try:
        # Cleanup container
        ray.get(executor.cleanup.remote())

        # Kill actor and wait for it to terminate
        ray.kill(executor, no_restart=True)

        # Wait for resources to be fully released
        # gVisor containers take longer to clean up than standard Docker
        time.sleep(2.0)

        return CleanupResult(
            status="success",
            session_id=session_id,
        )

    except Exception as e:
        logger.error(f"Failed to cleanup session {session_id}: {e}")
        return CleanupError(
            status="error",
            error=str(e),
            session_id=session_id,
        )
