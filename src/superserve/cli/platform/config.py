"""Platform API configuration constants."""

import os
from importlib.metadata import version
from pathlib import Path

# Production (default):
# PLATFORM_API_URL = os.environ.get("SUPERSERVE_API_URL", "https://api.superserve.ai")
# DASHBOARD_URL = os.environ.get(
#     "SUPERSERVE_DASHBOARD_URL", "https://console.superserve.ai"
# )
# Staging:
PLATFORM_API_URL = os.environ.get(
    "SUPERSERVE_API_URL", "https://api-staging.superserve.ai"
)
DASHBOARD_URL = os.environ.get(
    "SUPERSERVE_DASHBOARD_URL", "https://console-staging.superserve.ai"
)
# Local:
# PLATFORM_API_URL = os.environ.get("SUPERSERVE_API_URL", "http://localhost:8000")
# DASHBOARD_URL = os.environ.get("SUPERSERVE_DASHBOARD_URL", "http://localhost:3001")
SUPERSERVE_CONFIG_DIR = Path.home() / ".superserve"
CREDENTIALS_FILE = SUPERSERVE_CONFIG_DIR / "credentials.json"
USER_AGENT = f"superserve-cli/{version('superserve')}"
DEFAULT_TIMEOUT = 30  # seconds
DEVICE_POLL_INTERVAL = 5  # seconds
