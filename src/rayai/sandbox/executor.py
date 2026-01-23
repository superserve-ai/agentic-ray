"""Code Interpreter Executor - Manages Docker containers for code execution"""

import asyncio
import base64
import logging
import os
import tempfile
import time
from typing import TYPE_CHECKING

import ray

if TYPE_CHECKING:
    from docker import DockerClient
    from docker.models.containers import Container

from .backend import SandboxBackend
from .config import (
    CPU_PERIOD,
    CPU_QUOTA,
    DEFAULT_IMAGE,
    DEFAULT_TIMEOUT,
    MCP_SOCKET_DIR,
    MCP_SOCKET_PATH,
    MEMORY_LIMIT,
    NETWORK_MODE,
    RUNTIME,
    STRICT_GVISOR,
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

logger = logging.getLogger(__name__)

# Constants
SESSION_STATE_PATH = "/tmp/session_state.pkl"
CONTAINER_NAME_PREFIX = "ray-code"
SIDECAR_NAME_PREFIX = "ray-code-sidecar"
SIDECAR_IMAGE_TAG = "ray-code-sidecar:latest"
CONTAINER_STOP_TIMEOUT = 2


@ray.remote(num_cpus=1, memory=1024 * 1024 * 1024)  # 1GB
class CodeInterpreterExecutor(SandboxBackend):
    """
    Ray Actor that manages a Docker container for code execution.
    Each session gets one persistent container for state management.

    This is the Docker-based sandbox backend, suitable for local development
    and environments where Docker is available.
    """

    container: "Container | None"
    sidecar_container: "Container | None"
    client: "DockerClient | None"

    def __init__(
        self,
        session_id: str,
        image: str = DEFAULT_IMAGE,
        dockerfile: str | None = None,
        environment: dict[str, str] | None = None,
        volumes: dict[str, dict[str, str]] | None = None,
        mcp_allowlist: list[str] | None = None,
    ):
        """
        Initialize code executor with Docker container and MCP sidecar.

        Args:
            session_id: Unique session identifier
            image: Docker image to use (default: python:3.12-slim)
            dockerfile: Custom Dockerfile string (optional)
            environment: Environment variables for container
            volumes: Volume mounts for container. Format:
                {'/host/path': {'bind': '/container/path', 'mode': 'ro'}}
            mcp_allowlist: List of allowed MCP server URLs for sidecar proxy
        """
        super().__init__(
            session_id=session_id,
            image=image,
            dockerfile=dockerfile,
            environment=environment,
            volumes=volumes,
            mcp_allowlist=mcp_allowlist,
        )

        self.container = None
        self.sidecar_container = None
        self.client = None
        self.execution_count = 0
        self.created_at = time.time()

        # Validate volume paths exist
        for host_path in self.volumes.keys():
            if not os.path.exists(host_path):
                logger.warning(f"Volume mount host path does not exist: {host_path}")

        logger.info(f"CodeInterpreterExecutor initialized for session {session_id}")
        if self.mcp_allowlist:
            logger.info(f"MCP allowlist: {self.mcp_allowlist}")

    def _get_docker_client(self):
        """Lazy initialization of Docker client.

        Creates a Docker client that doesn't rely on credential helpers,
        which can fail in non-interactive environments (like Anyscale) when
        tokens expire and cannot be refreshed (e.g., gcloud auth).
        """
        if self.client is None:
            try:
                import docker

                # Use DockerClient with explicit base_url instead of from_env()
                # to avoid loading credential helpers from ~/.docker/config.json
                # which can fail in non-interactive environments
                base_url = os.environ.get("DOCKER_HOST", "unix://var/run/docker.sock")
                self.client = docker.DockerClient(base_url=base_url)
                logger.debug(f"Docker client initialized for session {self.session_id}")
            except ImportError as err:
                raise ImportError(
                    "docker package not installed. "
                    "Install with: pip install rayai[sandbox]"
                ) from err
            except Exception as e:
                raise RuntimeError(
                    f"Failed to initialize Docker client: {e}. "
                    "Make sure Docker is installed and running."
                ) from e
        return self.client

    def _transfer_file_to_container(self, content: bytes, dest_path: str) -> None:
        """
        Transfer file content to container using base64 encoding.

        This is a workaround for gVisor where Docker's put_archive API doesn't work properly.
        We use exec_run with base64 encoding to safely transfer file content.

        Args:
            content: File content as bytes
            dest_path: Destination path in container

        Raises:
            RuntimeError: If file transfer fails
        """
        container = self.container
        if container is None:
            raise RuntimeError("Container not initialized")

        # Encode content as base64 for safe shell transfer
        encoded_content = base64.b64encode(content).decode("ascii")

        # Ensure parent directory exists
        parent_dir = os.path.dirname(dest_path)
        if parent_dir:
            mkdir_result = container.exec_run(f'mkdir -p "{parent_dir}"')
            if mkdir_result.exit_code != 0:
                raise RuntimeError(f"Failed to create directory {parent_dir}")

        # Create file using shell command with base64 decoding
        create_cmd = f'sh -c "echo {encoded_content} | base64 -d > {dest_path}"'
        create_result = container.exec_run(create_cmd)

        if create_result.exit_code != 0:
            raise RuntimeError(
                f"Failed to create file {dest_path}: exit code {create_result.exit_code}"
            )

    @staticmethod
    def _parse_exec_output(output: tuple) -> tuple[str, str]:
        """Parse demuxed exec_run output into stdout and stderr strings"""
        stdout = output[0].decode() if output and output[0] else ""
        stderr = output[1].decode() if output and output[1] else ""
        return stdout, stderr

    async def execute(
        self, code: str, timeout: int = DEFAULT_TIMEOUT
    ) -> ExecutionResult | ExecutionError:
        """
        Execute Python code in the container.

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
            # Wrap the execution in asyncio.wait_for to enforce timeout
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

    async def execute_shell(
        self, command: str, timeout: int = DEFAULT_TIMEOUT
    ) -> ExecutionResult | ExecutionError:
        """
        Execute shell command in the container.

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

    async def _execute_code(
        self, code: str, execution_id: str
    ) -> ExecutionResult | ExecutionError:
        """Internal method to execute code (separated for timeout handling)"""
        try:
            # Ensure container is running
            self._ensure_container()

            # Wrap code to maintain session persistence via pickle
            wrapped_code = f"""
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
    \"\"\"Check if an object is safe to pickle\"\"\"
    # Skip private/builtin names
    # Skip modules, functions, and file objects
    return not isinstance(obj, (
        types.ModuleType,
        types.FunctionType,
        types.MethodType,
        types.BuiltinFunctionType,
        io.IOBase,  # File handles
    ))

# Execute user code in the loaded namespace
try:
    exec('''
{code}
''', globals_dict)
except Exception:
    # Save state even on error, then re-raise
    with open('{SESSION_STATE_PATH}', 'wb') as f:
        # Filter out non-picklable objects
        filtered = {{k: v for k, v in globals_dict.items()
                    if not k.startswith('_') and is_picklable(v)}}
        pickle.dump(filtered, f)
    raise

# Save updated session state
with open('{SESSION_STATE_PATH}', 'wb') as f:
    # Filter out non-picklable objects
    filtered = {{k: v for k, v in globals_dict.items()
                if not k.startswith('_') and is_picklable(v)}}
    pickle.dump(filtered, f)
"""

            # Create temp file with wrapped code
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
                f.write(wrapped_code)
                code_file = f.name

            try:
                # Transfer code file to container
                code_filename = os.path.basename(code_file)
                container_path = f"/tmp/{code_filename}"

                with open(code_file, "rb") as f:
                    code_data = f.read()

                logger.debug(
                    f"Transferring {code_filename} ({len(code_data)} bytes) to container"
                )
                self._transfer_file_to_container(code_data, container_path)

                # Execute code asynchronously
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)

                container = self.container
                if container is None:
                    raise RuntimeError("Container became None unexpectedly")
                exec_result = await loop.run_in_executor(
                    None,
                    lambda: container.exec_run(
                        f"python {container_path}",
                        demux=True,
                    ),
                )

                # Parse output
                stdout, stderr = self._parse_exec_output(exec_result.output)

                logger.info(
                    f"Execution {execution_id}: {'success' if exec_result.exit_code == 0 else 'error'}"
                )

                return ExecutionResult(
                    status="success" if exec_result.exit_code == 0 else "error",
                    stdout=stdout,
                    stderr=stderr,
                    exit_code=exec_result.exit_code,
                    execution_id=execution_id,
                )

            finally:
                # Cleanup temp file
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

    async def _execute_shell(
        self, command: str, execution_id: str
    ) -> ExecutionResult | ExecutionError:
        """Internal method to execute shell command"""
        try:
            # Ensure container is running
            self._ensure_container()

            # Execute shell command directly
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            container = self.container
            if container is None:
                raise RuntimeError("Container not initialized")

            # Execute command in shell
            exec_result = await loop.run_in_executor(
                None,
                lambda: container.exec_run(
                    f"sh -c {repr(command)}",
                    demux=True,
                ),
            )

            # Parse output
            stdout, stderr = self._parse_exec_output(exec_result.output)

            logger.info(
                f"Shell execution {execution_id}: {'success' if exec_result.exit_code == 0 else 'error'}"
            )

            return ExecutionResult(
                status="success" if exec_result.exit_code == 0 else "error",
                stdout=stdout,
                stderr=stderr,
                exit_code=exec_result.exit_code,
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
        Upload file to container.

        Args:
            path: Destination path in container
            content: File content as bytes

        Returns:
            Upload result
        """
        logger.info(f"Session {self.session_id}: Uploading file to {path}")

        try:
            self._ensure_container()
            self._transfer_file_to_container(content, path)
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
        """Get executor statistics"""
        container = self.container
        if container is None:
            container_status = "none"
        else:
            container_status = container.status

        return SessionStats(
            session_id=self.session_id,
            execution_count=self.execution_count,
            created_at=self.created_at,
            uptime=time.time() - self.created_at,
            container_status=container_status,
        )

    def _ensure_container(self):
        """Create container if doesn't exist or is stopped"""
        client = self._get_docker_client()

        # Ensure sidecar is running if MCP is configured
        self._ensure_sidecar()

        # Build custom image if Dockerfile provided
        if self.dockerfile and self.image == DEFAULT_IMAGE:
            self.image = self._build_image()
            self.dockerfile = None  # Only build once

        # Check if container exists and is running
        container = self.container
        if container is not None:
            try:
                container.reload()
                container_status = container.status
                if container_status == "running":
                    return
                if container_status == "exited":
                    logger.info(f"Session {self.session_id}: Restarting container")
                    container.start()
                    return
            except Exception as e:
                # Container may have been removed externally or connection lost
                logger.warning(
                    f"Session {self.session_id}: Container check failed - {e}"
                )
                self.container = None

        # Create new container
        logger.info(
            f"Session {self.session_id}: Creating container with image {self.image}"
        )

        container_name = f"{CONTAINER_NAME_PREFIX}-{self.session_id}"

        # Remove existing container with same name if it exists
        try:
            old_container = client.containers.get(container_name)
            logger.warning(f"Session {self.session_id}: Removing existing container")
            try:
                old_container.stop(timeout=CONTAINER_STOP_TIMEOUT)
            except Exception as stop_error:
                # Container may already be stopped or connection issue
                logger.debug(f"Session {self.session_id}: Stop failed: {stop_error}")
            old_container.remove(force=True)
        except Exception:
            # Container doesn't exist, which is fine
            pass

        # Prepare volumes (include socket volume if MCP allowlist is configured)
        container_volumes = self.volumes.copy() if self.volumes else {}
        if self.mcp_allowlist:
            # Mount shared Docker volume for MCP sidecar communication
            # Using Docker volume (inside Docker VM) for proper Unix socket support
            container_volumes["mcp-socket"] = {"bind": MCP_SOCKET_DIR, "mode": "rw"}

        # Network mode - keep isolated
        network_mode = NETWORK_MODE

        # Determine runtime to use
        runtime = RUNTIME

        # Log gVisor + MCP configuration
        if self.mcp_allowlist and runtime == "runsc":
            logger.info(
                f"Session {self.session_id}: Using gVisor with MCP. "
                "Ensure --fsgofer-host-uds is configured in /etc/docker/daemon.json"
            )
        try:
            self.container = client.containers.run(
                image=self.image,
                name=container_name,
                runtime=runtime,
                detach=True,
                tty=True,
                stdin_open=True,
                mem_limit=MEMORY_LIMIT,
                cpu_quota=CPU_QUOTA,
                cpu_period=CPU_PERIOD,
                network_mode=network_mode,
                environment=self.environment,
                volumes=container_volumes if container_volumes else None,
                remove=False,  # Keep for session persistence
            )
            logger.info(f"Session {self.session_id}: Container created successfully")

        except Exception as e:
            # If gVisor runtime not available, fall back to default runtime
            if "runsc" in str(e).lower() and RUNTIME == "runsc":
                if STRICT_GVISOR:
                    # Fail in strict mode
                    logger.error(
                        f"Session {self.session_id}: gVisor required but not available (STRICT_GVISOR=True)"
                    )
                    raise RuntimeError(
                        "gVisor (runsc) is required but not available. "
                        "Install gVisor or set STRICT_GVISOR=False in config."
                    ) from e
                else:
                    # Fallback to runc in non-strict mode
                    logger.warning(
                        f"Session {self.session_id}: gVisor not available, falling back to runc"
                    )
                    self.container = client.containers.run(
                        image=self.image,
                        name=container_name,
                        runtime="runc",  # Fallback to default
                        detach=True,
                        tty=True,
                        stdin_open=True,
                        mem_limit=MEMORY_LIMIT,
                        cpu_quota=CPU_QUOTA,
                        cpu_period=CPU_PERIOD,
                        network_mode=network_mode,
                        environment=self.environment,
                        volumes=container_volumes if container_volumes else None,
                        remove=False,
                    )
            else:
                raise

    def _build_image(self) -> str:
        """Build Docker image from Dockerfile string"""
        if self.dockerfile is None:
            raise RuntimeError("Dockerfile is None, cannot build image")

        client = self._get_docker_client()

        logger.info(f"Session {self.session_id}: Building custom Docker image")

        with tempfile.TemporaryDirectory() as tmpdir:
            dockerfile_path = os.path.join(tmpdir, "Dockerfile")
            with open(dockerfile_path, "w") as f:
                f.write(self.dockerfile)

            image, logs = client.images.build(
                path=tmpdir, tag=f"ray-code-custom-{self.session_id}"
            )

            # Log build output
            for log in logs:
                if "stream" in log:
                    logger.debug(log["stream"].strip())

            image_tag: str = image.tags[0]
            logger.info(f"Session {self.session_id}: Image built - {image_tag}")

            return image_tag

    def _ensure_sidecar(self):
        """Create and start MCP sidecar container if needed"""
        if not self.mcp_allowlist:
            return

        client = self._get_docker_client()

        # Check if sidecar exists and is running
        sidecar_container = self.sidecar_container
        if sidecar_container is not None:
            try:
                sidecar_container.reload()
                sidecar_status = sidecar_container.status
                if sidecar_status == "running":
                    return
                if sidecar_status == "exited":
                    logger.info(f"Session {self.session_id}: Restarting sidecar")
                    sidecar_container.start()
                    return
            except Exception as e:
                logger.warning(f"Session {self.session_id}: Sidecar check failed - {e}")
                self.sidecar_container = None

        # Ensure sidecar image exists
        self._ensure_sidecar_image()

        # Create new sidecar container
        logger.info(f"Session {self.session_id}: Creating MCP sidecar container")

        sidecar_name = f"{SIDECAR_NAME_PREFIX}-{self.session_id}"

        # Remove existing sidecar with same name if it exists
        try:
            old_sidecar = client.containers.get(sidecar_name)
            logger.warning(f"Session {self.session_id}: Removing existing sidecar")
            try:
                old_sidecar.stop(timeout=CONTAINER_STOP_TIMEOUT)
            except Exception:
                pass
            old_sidecar.remove(force=True)
        except Exception:
            pass

        # Create sidecar with Docker volume for Unix socket (not host mount)
        try:
            self.sidecar_container = client.containers.run(
                image=SIDECAR_IMAGE_TAG,
                name=sidecar_name,
                detach=True,
                network_mode="host",  # Use host network to access localhost MCP servers
                environment={
                    "MCP_SOCKET_PATH": MCP_SOCKET_PATH,
                    "MCP_ALLOWLIST": ",".join(self.mcp_allowlist),
                },
                volumes={"mcp-socket": {"bind": MCP_SOCKET_DIR, "mode": "rw"}},
                remove=False,
            )
            logger.info(
                f"Session {self.session_id}: Sidecar container created with socket at {MCP_SOCKET_PATH}"
            )
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to create sidecar: {e}")
            raise RuntimeError(f"Failed to create MCP sidecar container: {e}") from e

    def _ensure_sidecar_image(self):
        """Ensure sidecar Docker image exists, build if needed"""
        client = self._get_docker_client()

        try:
            client.images.get(SIDECAR_IMAGE_TAG)
            logger.debug(f"Sidecar image {SIDECAR_IMAGE_TAG} already exists")
            return
        except Exception:
            pass

        # Build sidecar image
        logger.info(f"Building sidecar image {SIDECAR_IMAGE_TAG}")

        # Get path to sandbox package directory
        import rayai.sandbox

        sandbox_dir = os.path.dirname(rayai.sandbox.__file__)
        dockerfile_path = os.path.join(sandbox_dir, "Dockerfile.sidecar")

        if not os.path.exists(dockerfile_path):
            raise RuntimeError(f"Sidecar Dockerfile not found at {dockerfile_path}")

        try:
            image, logs = client.images.build(
                path=sandbox_dir,
                dockerfile="Dockerfile.sidecar",
                tag=SIDECAR_IMAGE_TAG,
            )

            for log in logs:
                if "stream" in log:
                    logger.debug(log["stream"].strip())

            logger.info(f"Sidecar image {SIDECAR_IMAGE_TAG} built successfully")

        except Exception as e:
            logger.error(f"Failed to build sidecar image: {e}")
            raise RuntimeError(f"Failed to build sidecar image: {e}") from e

    def cleanup(self) -> CleanupResult | CleanupError:
        """Cleanup container and resources."""
        logger.info(f"Session {self.session_id}: Cleaning up Docker sandbox")

        try:
            self._cleanup_sidecar()
            self._cleanup_container()
            self._cleanup_docker_client()

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

    def _cleanup_sidecar(self):
        """Gracefully stop and remove sidecar container"""
        sidecar_container = self.sidecar_container
        if sidecar_container is None:
            return

        logger.info(f"Session {self.session_id}: Cleaning up sidecar")

        try:
            sidecar_container.stop(timeout=CONTAINER_STOP_TIMEOUT)
            logger.debug(f"Session {self.session_id}: Sidecar stopped gracefully")
        except Exception as e:
            logger.debug(
                f"Session {self.session_id}: Sidecar graceful stop failed: {e}"
            )

        try:
            sidecar_container.remove(force=True)
            logger.info(f"Session {self.session_id}: Sidecar removed")
        except Exception as e:
            logger.warning(f"Session {self.session_id}: Sidecar removal failed: {e}")
        finally:
            self.sidecar_container = None

    def _cleanup_container(self):
        """Gracefully stop and remove container"""
        container = self.container
        if container is None:
            return

        logger.info(f"Session {self.session_id}: Cleaning up container")

        try:
            # Try graceful stop with short timeout
            container.stop(timeout=CONTAINER_STOP_TIMEOUT)
            logger.debug(f"Session {self.session_id}: Container stopped gracefully")
        except Exception as e:
            logger.debug(f"Session {self.session_id}: Graceful stop failed: {e}")

        try:
            # Remove container (force=True ensures removal even if stop failed)
            container.remove(force=True)
            logger.info(f"Session {self.session_id}: Container removed")
        except Exception as e:
            logger.warning(f"Session {self.session_id}: Container removal failed: {e}")
        finally:
            self.container = None

    def _cleanup_docker_client(self):
        """Close Docker client connection"""
        client = self.client
        if client is None:
            return

        try:
            client.close()
            self.client = None
        except Exception as e:
            logger.debug(f"Session {self.session_id}: Docker client close failed: {e}")

    def __del__(self):
        """Cleanup on actor deletion"""
        try:
            self.cleanup()
        except Exception:
            # Ignore errors during __del__
            pass
