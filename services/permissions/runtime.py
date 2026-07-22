"""Process-wide PermissionService singleton + test injection hook.

Routers and the PEP resolve the live service through :func:`get_service` so
there is one read-model cache per process. Tests call :func:`set_service` to
swap in an instance backed by a temp DB.
"""
from __future__ import annotations

from .service import PermissionService

_service: PermissionService | None = None


def get_service() -> PermissionService:
    global _service
    if _service is None:
        _service = PermissionService()
    return _service


def set_service(svc: PermissionService | None) -> None:
    global _service
    _service = svc
