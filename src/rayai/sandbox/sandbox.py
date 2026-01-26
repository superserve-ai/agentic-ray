"""
Standard Sandbox API for code execution.

Provides an API compatible with E2B, Modal, and Kubernetes agent-sandbox patterns.

Usage:
    from rayai.sandbox import Sandbox

    # Context manager
    with Sandbox() as sandbox:
        result = sandbox.run_code("print('hello')")
        print(result.stdout)

    # For agents - run_code is a rayai.tool
    sandbox = Sandbox(dockerfile="FROM python:3.12-slim\\nRUN pip install pandas")
    agent = Agent("openai:gpt-4o-mini", tools=[sandbox.run_code])
"""

import logging
import time
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING

import ray

from .config import DEFAULT_IMAGE, DEFAULT_TIMEOUT

if TYPE_CHECKING:
    from ray.actor import ActorHandle

logger = logging.getLogger(__name__)


@dataclass
class ExecutionResult:
    """Result from code or shell execution."""

    stdout: str
    stderr: str
    exit_code: int

    @property
    def text(self) -> str:
        """Alias for stdout (E2B compatibility)."""
        return self.stdout

    @property
    def success(self) -> bool:
        return self.exit_code == 0


class Sandbox:
    """
    Secure sandbox for code execution.

    Compatible with E2B, Modal, and Kubernetes agent-sandbox patterns.
    Automatically selects Docker (local) or Kubernetes (production) backend.

    Args:
        dockerfile: Custom Dockerfile string for the sandbox environment
        image: Base Docker image (default: python:3.12-slim)
        timeout: Default execution timeout in seconds
        session_id: Optional session ID (auto-generated if not provided)

    Example:
        # Basic usage
        with Sandbox() as sandbox:
            result = sandbox.run_code("print(1 + 1)")
            print(result.stdout)  # "2"

        # With custom environment
        sandbox = Sandbox(
            dockerfile="FROM python:3.12-slim\\nRUN pip install pandas numpy"
        )
        with sandbox:
            sandbox.run_code("import pandas as pd; print(pd.__version__)")

        # For AI agents - run_code is a rayai.tool
        sandbox = Sandbox(dockerfile="...")
        agent = Agent("openai:gpt-4o-mini", tools=[sandbox.run_code])
        rayai.serve(agent, name="my_agent")
    """

    def __init__(
        self,
        dockerfile: str | None = None,
        image: str = DEFAULT_IMAGE,
        timeout: int = DEFAULT_TIMEOUT,
        session_id: str | None = None,
    ):
        self.dockerfile = dockerfile
        self.image = image
        self.timeout = timeout
        self.session_id = session_id or f"sandbox-{uuid.uuid4().hex[:8]}"
        self._executor: ActorHandle | None = None
        self._started = False

        # Make run_code a rayai.tool for agent use
        self._setup_tool()

    def _setup_tool(self):
        """Configure run_code as a rayai.tool."""
        import rayai

        # Store reference to self for creating per-session executors
        sandbox_config = self

        @rayai.tool(num_cpus=1)
        def run_code(code: str, session_id: str = "default") -> str:
            """Execute Python code in a secure sandbox.

            Variables and imports persist across calls within the same session_id.
            Save files to /tmp/ for persistence.

            Args:
                code: Python code to execute
                session_id: Session identifier for persistence (default: "default")

            Returns:
                Output from the code execution
            """
            # Create a sandbox with the user's session_id
            session_sandbox = Sandbox(
                dockerfile=sandbox_config.dockerfile,
                image=sandbox_config.image,
                timeout=sandbox_config.timeout,
                session_id=session_id,
            )
            result = session_sandbox._run_code(code)
            if result.success:
                output = result.stdout or "(no output)"
                if result.stderr:
                    output += f"\n[stderr]: {result.stderr}"
                return output
            else:
                return f"Error: {result.stderr or 'Unknown error'}"

        self.run_code = run_code

        @rayai.tool(num_cpus=0.5)
        def bash(command: str, session_id: str = "default") -> str:
            """Execute a bash command in the sandbox.

            Args:
                command: Bash command to execute (e.g., "ls /tmp", "cat file.csv")
                session_id: Session identifier for persistence

            Returns:
                Command output
            """
            session_sandbox = Sandbox(
                dockerfile=sandbox_config.dockerfile,
                image=sandbox_config.image,
                timeout=sandbox_config.timeout,
                session_id=session_id,
            )
            result = session_sandbox.exec(command)
            if result.success:
                return result.stdout or "(no output)"
            else:
                return f"Error: {result.stderr or 'Unknown error'}"

        self.bash = bash

    def _get_executor(self) -> "ActorHandle":
        """Get or create the sandbox executor."""
        if self._executor is not None:
            return self._executor

        from .backend import get_backend_type

        backend_type = get_backend_type()

        actor_name = f"sandbox-{self.session_id}"
        namespace = "sandbox"

        try:
            self._executor = ray.get_actor(actor_name, namespace=namespace)
            logger.debug(f"Found existing sandbox: {self.session_id}")
        except ValueError:
            logger.info(f"Creating sandbox: {self.session_id}")
            if backend_type == "kubernetes":
                from .kubernetes_executor import KubernetesSandboxExecutor

                self._executor = KubernetesSandboxExecutor.options(  # type: ignore[attr-defined]
                    name=actor_name,
                    namespace=namespace,
                    lifetime="detached",
                ).remote(
                    session_id=self.session_id,
                    image=self.image,
                    dockerfile=self.dockerfile,
                )
            else:
                from .executor import CodeInterpreterExecutor

                self._executor = CodeInterpreterExecutor.options(  # type: ignore[attr-defined]
                    name=actor_name,
                    namespace=namespace,
                    lifetime="detached",
                ).remote(
                    session_id=self.session_id,
                    image=self.image,
                    dockerfile=self.dockerfile,
                )

        self._started = True
        return self._executor

    def _run_code(self, code: str, timeout: int | None = None) -> ExecutionResult:
        """Internal implementation of run_code."""
        executor = self._get_executor()
        timeout = timeout or self.timeout

        result = ray.get(executor.execute.remote(code, timeout))

        return ExecutionResult(
            stdout=result.get("stdout", ""),
            stderr=result.get("stderr", result.get("error", "")),
            exit_code=result.get(
                "exit_code", 0 if result["status"] == "success" else 1
            ),
        )

    def exec(self, command: str, timeout: int | None = None) -> ExecutionResult:
        """Execute a shell command in the sandbox.

        Args:
            command: Shell command to execute
            timeout: Execution timeout in seconds

        Returns:
            ExecutionResult with stdout, stderr, exit_code
        """
        executor = self._get_executor()
        timeout = timeout or self.timeout

        result = ray.get(executor.execute_shell.remote(command, timeout))

        return ExecutionResult(
            stdout=result.get("stdout", ""),
            stderr=result.get("stderr", result.get("error", "")),
            exit_code=result.get(
                "exit_code", 0 if result["status"] == "success" else 1
            ),
        )

    def upload(self, path: str, content: bytes) -> None:
        """Upload a file to the sandbox.

        Args:
            path: Destination path in sandbox (e.g., "/tmp/data.csv")
            content: File content as bytes
        """
        executor = self._get_executor()
        result = ray.get(executor.upload_file.remote(path, content))

        if result.get("status") != "success":
            raise RuntimeError(f"Upload failed: {result.get('error', 'Unknown error')}")

    def terminate(self) -> None:
        """Terminate the sandbox and clean up resources."""
        if self._executor is None:
            return

        try:
            ray.get(self._executor.cleanup.remote())
            ray.kill(self._executor, no_restart=True)
            time.sleep(1.0)
            logger.info(f"Sandbox terminated: {self.session_id}")
        except Exception as e:
            logger.warning(f"Error terminating sandbox: {e}")
        finally:
            self._executor = None
            self._started = False

    def __enter__(self) -> "Sandbox":
        """Enter context manager."""
        self._get_executor()  # Ensure executor is created
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit context manager and cleanup."""
        self.terminate()

    def __del__(self):
        """Cleanup on garbage collection."""
        if self._started:
            try:
                self.terminate()
            except Exception:
                pass
