"""Superserve - CLI and SDK for hosted agent infrastructure."""

import importlib.metadata

try:
    __version__ = importlib.metadata.version(__name__)
except importlib.metadata.PackageNotFoundError:
    __version__ = "unknown"

__all__ = ["__version__"]
