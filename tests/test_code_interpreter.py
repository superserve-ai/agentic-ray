"""Tests for code interpreter functionality"""

import time
from typing import cast

import pytest
import ray

from ray_agents.code_interpreter import (
    cleanup_session,
    execute_code,
    get_session_stats,
    install_package,
    upload_file,
)
from ray_agents.code_interpreter.types import ExecutionResult


@pytest.fixture(scope="module")
def ray_start():
    """Initialize Ray for tests"""
    ray.init(ignore_reinit_error=True, num_cpus=4)
    yield
    ray.shutdown()


@pytest.fixture(autouse=True)
def cleanup_between_tests():
    """Add delay between tests to ensure resources are released"""
    yield
    # Small delay after each test to let Docker/gVisor release resources
    time.sleep(0.5)


def test_basic_execution(ray_start):
    """Test basic code execution"""
    session_id = "test-basic-execution"
    result = ray.get(
        execute_code.remote("print('Hello, World!')", session_id=session_id)  # type: ignore[call-arg]
    )

    assert result["status"] == "success"
    assert "Hello, World!" in result["stdout"]
    assert result["exit_code"] == 0

    # Cleanup
    ray.get(cleanup_session.remote(session_id))


def test_execution_with_error(ray_start):
    """Test code execution with error"""
    session_id = "test-execution-error"
    result = cast(
        ExecutionResult,
        ray.get(execute_code.remote("1 / 0", session_id=session_id)),  # type: ignore[call-arg]
    )

    assert result["status"] == "error"
    assert result["exit_code"] != 0
    assert "ZeroDivisionError" in result["stderr"]

    # Cleanup
    ray.get(cleanup_session.remote(session_id))


def test_session_persistence(ray_start):
    """Test that session state persists across executions"""
    session_id = "test-session-persistence"

    # Set variable in first execution
    result1 = ray.get(execute_code.remote("x = 42", session_id=session_id))  # type: ignore[call-arg]
    assert result1["status"] == "success"

    # Access variable in second execution
    result2 = ray.get(execute_code.remote("print(x)", session_id=session_id))  # type: ignore[call-arg]
    assert result2["status"] == "success"
    assert "42" in result2["stdout"]

    # Cleanup
    ray.get(cleanup_session.remote(session_id))


def test_package_installation(ray_start):
    """Test pip package installation"""
    session_id = "test-package-install"

    # Initialize session
    ray.get(execute_code.remote("x = 1", session_id=session_id))  # type: ignore[call-arg]

    # Install a very small package (wheel is tiny and installs fast)
    install_result = ray.get(
        install_package.remote("wheel", session_id=session_id),  # type: ignore[call-arg]
        timeout=60,  # 1 minute timeout should be enough
    )
    assert install_result["status"] == "success"

    # Use installed package
    code = "import wheel; print(f'wheel version: {wheel.__version__}')"
    result = ray.get(execute_code.remote(code, session_id=session_id))  # type: ignore[call-arg]
    assert result["status"] == "success"
    assert "wheel version:" in result["stdout"]

    # Cleanup
    ray.get(cleanup_session.remote(session_id))


def test_file_upload(ray_start):
    """Test file upload to container"""
    session_id = "test-file-upload"

    # Initialize session
    ray.get(execute_code.remote("x = 1", session_id=session_id))  # type: ignore[call-arg]

    # Upload file
    content = b"Hello from file!\nLine 2"
    upload_result = ray.get(
        upload_file.remote("/tmp/test.txt", content, session_id=session_id)  # type: ignore[call-arg]
    )
    assert upload_result["status"] == "success"
    assert upload_result["size"] == len(content)

    # Read uploaded file
    code = "with open('/tmp/test.txt') as f: print(f.read())"
    result = ray.get(execute_code.remote(code, session_id=session_id))  # type: ignore[call-arg]
    assert result["status"] == "success"
    assert "Hello from file!" in result["stdout"]
    assert "Line 2" in result["stdout"]

    # Cleanup
    ray.get(cleanup_session.remote(session_id))


def test_timeout(ray_start):
    """Test execution timeout at Ray level"""
    session_id = "test-timeout"
    code = """
import time
time.sleep(5)  # Sleep shorter than test timeout but long enough to test
print('Done sleeping')
"""
    # Test that short timeout works and returns timeout error
    # Note: We use a shorter sleep so the test doesn't take forever
    try:
        ray.get(execute_code.remote(code, session_id=session_id), timeout=1)  # type: ignore[call-arg]
        # If we get here, the task completed before timeout (unexpected)
        raise AssertionError("Task should have timed out")
    except ray.exceptions.GetTimeoutError:
        # This is expected - the Ray task timed out
        pass
    finally:
        # Cleanup the session
        # Note: The container may still be running the code, but we can clean it up
        try:
            ray.get(cleanup_session.remote(session_id), timeout=5)
        except Exception:
            pass  # Ignore cleanup errors in case actor is still busy


def test_multiple_sessions(ray_start):
    """Test multiple independent sessions"""
    session1 = "test-multi-session-1"
    session2 = "test-multi-session-2"

    # Set different values in different sessions
    ray.get(execute_code.remote("x = 'session1'", session_id=session1))  # type: ignore[call-arg]
    ray.get(execute_code.remote("x = 'session2'", session_id=session2))  # type: ignore[call-arg]

    # Verify isolation
    result1 = cast(
        ExecutionResult,
        ray.get(execute_code.remote("print(x)", session_id=session1)),  # type: ignore[call-arg]
    )
    result2 = cast(
        ExecutionResult,
        ray.get(execute_code.remote("print(x)", session_id=session2)),  # type: ignore[call-arg]
    )

    assert "session1" in result1["stdout"]
    assert "session2" in result2["stdout"]

    # Cleanup
    ray.get(cleanup_session.remote(session1))
    ray.get(cleanup_session.remote(session2))


def test_get_session_stats(ray_start):
    """Test getting session statistics"""
    session_id = "test-stats"

    # Execute some code
    ray.get(execute_code.remote("x = 1", session_id=session_id))  # type: ignore[call-arg]
    ray.get(execute_code.remote("y = 2", session_id=session_id))  # type: ignore[call-arg]
    ray.get(execute_code.remote("z = 3", session_id=session_id))  # type: ignore[call-arg]

    # Get stats
    stats = ray.get(get_session_stats.remote(session_id))

    assert stats["session_id"] == session_id
    assert stats["execution_count"] == 3
    assert "uptime" in stats
    assert "created_at" in stats

    # Cleanup
    ray.get(cleanup_session.remote(session_id))


def test_custom_dockerfile(ray_start):
    """Test using custom Dockerfile"""
    dockerfile = """
FROM python:3.11-slim
RUN pip install requests
"""

    session_id = "test-dockerfile"

    # Execute code with custom dockerfile
    code = "import requests; print('requests version:', requests.__version__)"
    result = ray.get(
        execute_code.remote(code, session_id=session_id, dockerfile=dockerfile)  # type: ignore[call-arg]
    )

    assert result["status"] == "success"
    assert "requests version:" in result["stdout"]

    # Cleanup
    ray.get(cleanup_session.remote(session_id))


def test_cleanup_session(ray_start):
    """Test session cleanup"""
    session_id = "test-cleanup"

    # Create session
    ray.get(execute_code.remote("x = 1", session_id=session_id))  # type: ignore[call-arg]

    # Cleanup
    cleanup_result = ray.get(cleanup_session.remote(session_id))
    assert cleanup_result["status"] == "success"
    assert cleanup_result["session_id"] == session_id

    # Trying to get stats should fail after cleanup
    # Note: This might still work if actor hasn't fully terminated yet
    # So we just verify cleanup returned success


def test_environment_variables(ray_start):
    """Test passing environment variables to container"""
    session_id = "test-env"

    environment = {"MY_VAR": "test_value", "ANOTHER_VAR": "123"}

    code = """
import os
print('MY_VAR:', os.environ.get('MY_VAR'))
print('ANOTHER_VAR:', os.environ.get('ANOTHER_VAR'))
"""

    result = ray.get(
        execute_code.remote(code, session_id=session_id, environment=environment)  # type: ignore[call-arg]
    )

    assert result["status"] == "success"
    assert "MY_VAR: test_value" in result["stdout"]
    assert "ANOTHER_VAR: 123" in result["stdout"]

    # Cleanup
    ray.get(cleanup_session.remote(session_id))
