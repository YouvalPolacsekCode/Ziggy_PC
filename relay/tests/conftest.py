"""Shared fixtures for relay/tests. Ensures repo root is importable so
`from relay.app import ...` works when this directory is run directly
(`pytest relay/tests/`)."""

from __future__ import annotations

import os
import sys

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
