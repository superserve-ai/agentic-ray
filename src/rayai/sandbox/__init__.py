"""
Ray Sandbox - Execute code and shell commands securely in isolated containers

The sandbox automatically detects the environment and uses the appropriate backend:
- Kubernetes: Uses agent-sandbox SDK (for Anyscale, GKE, etc.)
- Docker: Uses Docker containers with optional gVisor (for local development)

You can override the backend by setting RAYAI_SANDBOX_BACKEND environment variable:
    export RAYAI_SANDBOX_BACKEND=kubernetes  # Force Kubernetes backend
    export RAYAI_SANDBOX_BACKEND=docker      # Force Docker backend

Basic usage:
    from rayai.sandbox import execute_code, execute_shell

    # Python code execution
    result = ray.get(execute_code.remote("print('Hello!')"))
    print(result["stdout"])  # "Hello!"

    # Shell command execution
    result = ray.get(execute_shell.remote("ls -la"))
    print(result["stdout"])

With sessions:
    # Variables persist across Python executions
    ray.get(execute_code.remote("x = 5", session_id="user-123"))
    result = ray.get(execute_code.remote("print(x)", session_id="user-123"))
    # Output: 5 (state persisted)

    # Shell and code share the same sandbox
    ray.get(execute_shell.remote("echo 'test' > /tmp/file.txt", session_id="user-123"))
    ray.get(execute_code.remote("print(open('/tmp/file.txt').read())", session_id="user-123"))

With custom environments (Docker backend only):
    dockerfile = '''
    FROM python:3.11-slim
    RUN pip install pandas
    '''
    result = ray.get(execute_code.remote(
        "import pandas; print(pandas.__version__)",
        dockerfile=dockerfile,
        session_id="custom-env"
    ))

Kubernetes backend configuration:
    export RAYAI_SANDBOX_TEMPLATE=python-runtime-template
    export RAYAI_SANDBOX_NAMESPACE=default
"""

from .backend import SandboxBackend, get_backend_type
from .tools import (
    cleanup_session,
    execute_code,
    execute_shell,
    get_session_stats,
    upload_file,
)
from .types import (
    CleanupError,
    CleanupResult,
    ExecutionError,
    ExecutionResult,
    SessionStats,
    UploadError,
    UploadResult,
)

__all__ = [
    # Tools
    "execute_code",
    "execute_shell",
    "upload_file",
    "get_session_stats",
    "cleanup_session",
    # Types
    "ExecutionResult",
    "ExecutionError",
    "UploadResult",
    "UploadError",
    "SessionStats",
    "CleanupResult",
    "CleanupError",
    # Backend
    "SandboxBackend",
    "get_backend_type",
]
