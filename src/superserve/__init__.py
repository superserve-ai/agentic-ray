"""Superserve - CLI and SDK for hosted agent infrastructure."""

import importlib.metadata

from superserve.sdk.app import App

try:
    __version__ = importlib.metadata.version(__name__)
except importlib.metadata.PackageNotFoundError:
    __version__ = "unknown"

__all__ = ["__version__", "App"]
