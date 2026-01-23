#!/usr/bin/env python3
"""Test script for sandbox backends.

Usage:
    # Test with auto-detected backend
    python scripts/test-sandbox-backend.py

    # Force Docker backend
    RAYAI_SANDBOX_BACKEND=docker python scripts/test-sandbox-backend.py

    # Force Kubernetes backend (requires kind cluster setup)
    RAYAI_SANDBOX_BACKEND=kubernetes python scripts/test-sandbox-backend.py
"""

import os
import sys

# Add src to path for development
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


def main():
    import ray

    from rayai.sandbox import (
        cleanup_session,
        execute_code,
        execute_shell,
        get_backend_type,
    )

    # Detect backend
    backend = get_backend_type()
    print(f"\n=== Testing sandbox with {backend} backend ===\n")

    # Initialize Ray
    if not ray.is_initialized():
        ray.init()

    session_id = "test-session-001"

    try:
        # Test 1: Simple code execution
        print("Test 1: Simple code execution")
        result = ray.get(
            execute_code.remote("print('Hello from sandbox!')", session_id=session_id)
        )
        print(f"  Status: {result['status']}")
        print(f"  Stdout: {result.get('stdout', '').strip()}")
        if result.get("stderr"):
            print(f"  Stderr: {result['stderr'].strip()}")
        assert (
            result["status"] == "success"
        ), f"Expected success, got {result['status']}"
        print("  ✓ Passed\n")

        # Test 2: Session persistence
        print("Test 2: Session persistence")
        ray.get(execute_code.remote("x = 42", session_id=session_id))
        result = ray.get(
            execute_code.remote("print(f'x = {x}')", session_id=session_id)
        )
        print(f"  Status: {result['status']}")
        print(f"  Stdout: {result.get('stdout', '').strip()}")
        assert "42" in result.get("stdout", ""), "Session state not persisted"
        print("  ✓ Passed\n")

        # Test 3: Shell execution
        print("Test 3: Shell execution")
        result = ray.get(
            execute_shell.remote("echo 'Shell works!'", session_id=session_id)
        )
        print(f"  Status: {result['status']}")
        print(f"  Stdout: {result.get('stdout', '').strip()}")
        assert (
            result["status"] == "success"
        ), f"Expected success, got {result['status']}"
        print("  ✓ Passed\n")

        # Test 4: Error handling
        print("Test 4: Error handling")
        result = ray.get(
            execute_code.remote("raise ValueError('test error')", session_id=session_id)
        )
        print(f"  Status: {result['status']}")
        print(f"  Stderr: {result.get('stderr', '').strip()[:100]}...")
        assert result["status"] == "error", "Expected error status for raised exception"
        print("  ✓ Passed\n")

        print("=" * 50)
        print(f"All tests passed with {backend} backend!")
        print("=" * 50)

    finally:
        # Cleanup
        print("\nCleaning up session...")
        result = ray.get(cleanup_session.remote(session_id))
        print(f"Cleanup: {result['status']}")


if __name__ == "__main__":
    main()
