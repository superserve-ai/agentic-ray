"""Configuration for Code Interpreter"""

import os
import platform

# Default Docker image for code execution
DEFAULT_IMAGE = os.environ.get("RAYAI_SANDBOX_IMAGE", "python:3.12-slim")

# Docker runtime (use "runsc" for gVisor isolation, "runc" for standard)
# gVisor only works on Linux, so default to "runc" on other platforms
_default_runtime = "runsc" if platform.system() == "Linux" else "runc"
RUNTIME = os.environ.get("RAYAI_SANDBOX_RUNTIME", _default_runtime)

# Strict mode: Fail if gVisor is unavailable
# Default to False for easier local development; set RAYAI_STRICT_GVISOR=true for production
STRICT_GVISOR = os.environ.get("RAYAI_STRICT_GVISOR", "false").lower() == "true"

# Default execution timeout in seconds
DEFAULT_TIMEOUT = 30

# Resource limits
MEMORY_LIMIT = "512m"  # 512MB
CPU_QUOTA = 100000  # 1.0 CPU (100000 = 100%)
CPU_PERIOD = 100000

# Session settings
SESSION_TIMEOUT = 3600  # 1 hour before auto-cleanup

# Network settings
NETWORK_MODE = (
    "none"  # Complete network isolation - external access via MCP sidecar only
)

# MCP Sidecar settings
MCP_SOCKET_PATH = "/tmp/mcp.sock"  # Unix socket path for MCP communication
MCP_SOCKET_DIR = "/tmp"  # Directory for socket file (on host)
