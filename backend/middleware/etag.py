"""ETag / 304 helper for static-ish GETs.

Usage in a router:

    from backend.middleware.etag import etag_response

    @router.get("/api/devices")
    async def get_devices(request: Request):
        body = {"devices": _get_enriched_devices()}
        return etag_response(request, body)

If the client sends `If-None-Match` matching the computed body hash, the
helper returns `Response(304)` (no body, just the ETag header). Otherwise
it returns the body as JSON with the ETag header attached.

The hash is over the JSON-serialised body, stable across runs because the
serialiser uses sorted keys. For ~10 KB device snapshots this is well under
a millisecond — far cheaper than sending the bytes if they haven't changed.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse, Response


def _compute_etag(body: Any) -> str:
    raw = json.dumps(body, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    return '"' + hashlib.md5(raw).hexdigest() + '"'  # noqa: S324 — md5 used as a hash, not a MAC


def etag_response(request: Request, body: Any) -> Response:
    """Return body as JSON with ETag, or 304 if the client already has it."""
    etag = _compute_etag(body)
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "private, must-revalidate"})
    return JSONResponse(
        content=body,
        headers={"ETag": etag, "Cache-Control": "private, must-revalidate"},
    )
