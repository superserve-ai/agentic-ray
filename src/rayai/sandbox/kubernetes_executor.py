"""Kubernetes-based sandbox executor using agent-sandbox.

This module provides a sandbox backend that works with the kubernetes-sigs/agent-sandbox
project, enabling secure code execution in Kubernetes environments like Anyscale, GKE, etc.

Requires:
    - Kubernetes cluster with agent-sandbox controller installed
    - SandboxTemplate configured for Python runtime
    - agentic-sandbox-client package installed

Installation:
    pip install "git+https://github.com/kubernetes-sigs/agent-sandbox.git#subdirectory=clients/python/agentic-sandbox-client"
"""

import asyncio
import base64
import logging
import os
import tempfile
import time
from typing import TYPE_CHECKING

import ray

from .backend import SandboxBackend
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

if TYPE_CHECKING:
    from agentic_sandbox import SandboxClient  # type: ignore[import-not-found]

logger = logging.getLogger(__name__)

# Default sandbox template name (must exist in cluster)
DEFAULT_TEMPLATE_NAME = os.environ.get(
    "RAYAI_SANDBOX_TEMPLATE", "python-runtime-template"
)
DEFAULT_NAMESPACE = os.environ.get("RAYAI_SANDBOX_NAMESPACE", "default")

# Session state path inside sandbox
SESSION_STATE_PATH = "/tmp/session_state.pkl"


@ray.remote(
    num_cpus=0.5, memory=512 * 1024 * 1024
)  # 512MB - lighter than Docker backend
class KubernetesSandboxExecutor(SandboxBackend):
    """
    Ray Actor that manages a Kubernetes sandbox for code execution.
    Uses the agent-sandbox SDK to create and manage sandbox pods.
    """

    sandbox: "SandboxClient | None"

    def __init__(
        self,
        session_id: str,
        image: str = DEFAULT_IMAGE,
        dockerfile: str | None = None,
        environment: dict[str, str] | None = None,
        volumes: dict[str, dict[str, str]] | None = None,
        mcp_allowlist: list[str] | None = None,
        template_name: str | None = None,
        namespace: str | None = None,
    ):
        """
        Initialize Kubernetes sandbox executor.

        Args:
            session_id: Unique session identifier
            image: Docker image (used to select template if custom templates exist)
            dockerfile: Custom Dockerfile (not supported in K8s mode, logs warning)
            environment: Environment variables for sandbox
            volumes: Volume mounts (requires PVC configuration in template)
            mcp_allowlist: MCP servers allowlist (requires sidecar in template)
            template_name: Kubernetes SandboxTemplate name
            namespace: Kubernetes namespace for sandbox
        """
        super().__init__(
            session_id=session_id,
            image=image,
            dockerfile=dockerfile,
            environment=environment,
            volumes=volumes,
            mcp_allowlist=mcp_allowlist,
        )

        self.template_name = template_name or DEFAULT_TEMPLATE_NAME
        self.namespace = namespace or DEFAULT_NAMESPACE
        self.sandbox = None
        self.execution_count = 0
        self.created_at = time.time()

        # Warn about unsupported features in K8s mode
        if dockerfile:
            logger.warning(
                f"Session {session_id}: Custom Dockerfile not supported in Kubernetes mode. "
                "Use a pre-built image or configure a custom SandboxTemplate."
            )
        if volumes:
            logger.warning(
                f"Session {session_id}: Volume mounts require PVC configuration in SandboxTemplate."
            )
        if mcp_allowlist:
            logger.warning(
                f"Session {session_id}: MCP allowlist requires sidecar container in SandboxTemplate."
            )

        logger.info(
            f"KubernetesSandboxExecutor initialized for session {session_id} "
            f"using template {self.template_name} in namespace {self.namespace}"
        )

    def _get_sandbox_client(self) -> "SandboxClient":
        """Get or create sandbox client."""
        if self.sandbox is None:
            try:
                from agentic_sandbox import SandboxClient
            except ImportError as err:
                raise ImportError(
                    "agentic-sandbox-client package not installed. Install with:\n"
                    'pip install "git+https://github.com/kubernetes-sigs/agent-sandbox.git'
                    '#subdirectory=clients/python/agentic-sandbox-client"'
                ) from err

            logger.info(f"Session {self.session_id}: Creating Kubernetes sandbox")

            # Create sandbox using template
            # The SDK handles kubectl port-forwarding in dev mode
            # or uses gateway in production mode
            self.sandbox = SandboxClient(
                template_name=self.template_name,
                namespace=self.namespace,
            )
            # Enter the context manager to create the sandbox
            self.sandbox.__enter__()

            logger.info(f"Session {self.session_id}: Kubernetes sandbox created")

        return self.sandbox

    async def execute(
        self, code: str, timeout: int = DEFAULT_TIMEOUT
    ) -> ExecutionResult | ExecutionError:
        """
        Execute Python code in the Kubernetes sandbox.

        Args:
            code: Python code to execute
            timeout: Execution timeout in seconds

        Returns:
            Execution result with status, stdout, stderr, exit_code
        """
        self.execution_count += 1
        execution_id = f"{self.session_id}_{self.execution_count}"

        logger.info(f"Execution {execution_id}: Starting")

        try:
            return await asyncio.wait_for(
                self._execute_code(code, execution_id), timeout=timeout
            )
        except TimeoutError:
            logger.error(f"Execution {execution_id}: Timed out after {timeout}s")
            return ExecutionError(
                status="error",
                error=f"Execution timed out after {timeout} seconds",
                error_type="TimeoutError",
                execution_id=execution_id,
            )
        except Exception as e:
            logger.error(f"Execution {execution_id}: Failed - {e}", exc_info=True)
            return ExecutionError(
                status="error",
                error=str(e),
                error_type=type(e).__name__,
                execution_id=execution_id,
            )

    async def _execute_code(
        self, code: str, execution_id: str
    ) -> ExecutionResult | ExecutionError:
        """Internal method to execute code."""
        try:
            sandbox = self._get_sandbox_client()

            # Wrap code to maintain session persistence via pickle
            # Same pattern as Docker executor
            wrapped_code = f'''
import pickle
import sys
import os
import types
import io

# Load previous session state if exists
globals_dict = {{}}
if os.path.exists('{SESSION_STATE_PATH}'):
    try:
        with open('{SESSION_STATE_PATH}', 'rb') as f:
            globals_dict = pickle.load(f)
    except Exception as e:
        print(f'Warning: Failed to load session state: {{e}}', file=sys.stderr)

def is_picklable(obj):
    """Check if an object is safe to pickle"""
    return not isinstance(obj, (
        types.ModuleType,
        types.FunctionType,
        types.MethodType,
        types.BuiltinFunctionType,
        io.IOBase,
    ))

# Execute user code in the loaded namespace
try:
    exec("""
{code}
""", globals_dict)
except Exception:
    # Save state even on error, then re-raise
    with open('{SESSION_STATE_PATH}', 'wb') as f:
        filtered = {{k: v for k, v in globals_dict.items()
                    if not k.startswith('_') and is_picklable(v)}}
        pickle.dump(filtered, f)
    raise

# Save updated session state
with open('{SESSION_STATE_PATH}', 'wb') as f:
    filtered = {{k: v for k, v in globals_dict.items()
                if not k.startswith('_') and is_picklable(v)}}
    pickle.dump(filtered, f)
'''

            # Write wrapped code to temp file and execute
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
                f.write(wrapped_code)
                code_file = f.name

            try:
                # Read the file content and execute via sandbox
                with open(code_file) as f:
                    script_content = f.read()

                # Execute in sandbox using the SDK
                # Use base64 to write script to file, then execute
                encoded_script = base64.b64encode(script_content.encode()).decode()

                # Write script to temp file and execute it
                # Using bash -c to properly handle the pipe
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: sandbox.run(
                        f"bash -c 'echo {encoded_script} | base64 -d > /tmp/script.py && python3 /tmp/script.py'"
                    ),
                )

                stdout = result.stdout if hasattr(result, "stdout") else str(result)
                stderr = result.stderr if hasattr(result, "stderr") else ""
                exit_code = result.exit_code if hasattr(result, "exit_code") else 0

                logger.info(
                    f"Execution {execution_id}: {'success' if exit_code == 0 else 'error'}"
                )

                return ExecutionResult(
                    status="success" if exit_code == 0 else "error",
                    stdout=stdout,
                    stderr=stderr,
                    exit_code=exit_code,
                    execution_id=execution_id,
                )

            finally:
                try:
                    os.unlink(code_file)
                except OSError:
                    pass

        except Exception as e:
            logger.error(f"Execution {execution_id}: Failed - {e}", exc_info=True)
            return ExecutionError(
                status="error",
                error=str(e),
                error_type=type(e).__name__,
                execution_id=execution_id,
            )

    async def execute_shell(
        self, command: str, timeout: int = DEFAULT_TIMEOUT
    ) -> ExecutionResult | ExecutionError:
        """
        Execute shell command in the Kubernetes sandbox.

        Args:
            command: Shell command to execute
            timeout: Execution timeout in seconds

        Returns:
            Execution result with status, stdout, stderr, exit_code
        """
        self.execution_count += 1
        execution_id = f"{self.session_id}_shell_{self.execution_count}"

        logger.info(f"Shell execution {execution_id}: {command[:100]}")

        try:
            return await asyncio.wait_for(
                self._execute_shell(command, execution_id), timeout=timeout
            )
        except TimeoutError:
            logger.error(f"Shell execution {execution_id}: Timed out after {timeout}s")
            return ExecutionError(
                status="error",
                error=f"Shell execution timed out after {timeout} seconds",
                error_type="TimeoutError",
                execution_id=execution_id,
            )
        except Exception as e:
            logger.error(f"Shell execution {execution_id}: Failed - {e}", exc_info=True)
            return ExecutionError(
                status="error",
                error=str(e),
                error_type=type(e).__name__,
                execution_id=execution_id,
            )

    async def _execute_shell(
        self, command: str, execution_id: str
    ) -> ExecutionResult | ExecutionError:
        """Internal method to execute shell command."""
        try:
            sandbox = self._get_sandbox_client()

            # Execute command via sandbox SDK
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: sandbox.run(command),
            )

            stdout = result.stdout if hasattr(result, "stdout") else str(result)
            stderr = result.stderr if hasattr(result, "stderr") else ""
            exit_code = result.exit_code if hasattr(result, "exit_code") else 0

            logger.info(
                f"Shell execution {execution_id}: {'success' if exit_code == 0 else 'error'}"
            )

            return ExecutionResult(
                status="success" if exit_code == 0 else "error",
                stdout=stdout,
                stderr=stderr,
                exit_code=exit_code,
                execution_id=execution_id,
            )

        except Exception as e:
            logger.error(f"Shell execution {execution_id}: Failed - {e}", exc_info=True)
            return ExecutionError(
                status="error",
                error=str(e),
                error_type=type(e).__name__,
                execution_id=execution_id,
            )

    def upload_file(self, path: str, content: bytes) -> UploadResult | UploadError:
        """
        Upload file to Kubernetes sandbox.

        Args:
            path: Destination path in sandbox
            content: File content as bytes

        Returns:
            Upload result
        """
        logger.info(f"Session {self.session_id}: Uploading file to {path}")

        try:
            sandbox = self._get_sandbox_client()

            # Use base64 encoding to transfer file content
            encoded_content = base64.b64encode(content).decode("ascii")

            # Create file using shell command
            parent_dir = os.path.dirname(path)
            if parent_dir:
                sandbox.run(f'mkdir -p "{parent_dir}"')

            sandbox.run(f'echo {encoded_content} | base64 -d > "{path}"')

            logger.info(f"Session {self.session_id}: File uploaded successfully")

            return UploadResult(
                status="success",
                path=path,
                size=len(content),
            )

        except Exception as e:
            logger.error(
                f"Session {self.session_id}: Failed to upload file - {e}",
                exc_info=True,
            )
            return UploadError(
                status="error",
                error=str(e),
                error_type=type(e).__name__,
            )

    def get_stats(self) -> SessionStats:
        """Get executor statistics."""
        sandbox_status = "none"
        if self.sandbox is not None:
            sandbox_status = "running"

        return SessionStats(
            session_id=self.session_id,
            execution_count=self.execution_count,
            created_at=self.created_at,
            uptime=time.time() - self.created_at,
            container_status=sandbox_status,
        )

    def cleanup(self) -> CleanupResult | CleanupError:
        """Cleanup sandbox resources."""
        logger.info(f"Session {self.session_id}: Cleaning up Kubernetes sandbox")

        try:
            if self.sandbox is not None:
                # Exit the context manager to cleanup
                self.sandbox.__exit__(None, None, None)
                self.sandbox = None
                logger.info(f"Session {self.session_id}: Kubernetes sandbox cleaned up")

            return CleanupResult(
                status="success",
                session_id=self.session_id,
            )

        except Exception as e:
            logger.error(
                f"Session {self.session_id}: Cleanup failed - {e}", exc_info=True
            )
            return CleanupError(
                status="error",
                error=str(e),
                session_id=self.session_id,
            )

    def __del__(self):
        """Cleanup on actor deletion."""
        try:
            self.cleanup()
        except Exception:
            pass
