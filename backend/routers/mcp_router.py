"""MCP server for external agents — Streamable HTTP transport, JSON responses.

    POST   /mcp   JSON-RPC 2.0 (single object or batch array)
    GET    /mcp   405 — SSE streams are not offered; clients must POST
    DELETE /mcp   204 — sessions are stateless here, nothing to end

Methods: initialize, notifications/* (202), ping, tools/list, tools/call.
Tools ARE the action registry (core/actions): same names, same JSON schemas,
same executors and gates as the chat agent and the app's buttons.

Auth is `Authorization: Bearer zgy_…` — a token minted per person in
Settings → External assistants (services/external_tokens.py). This is a
different credential class from an app session, so this router is registered
WITHOUT the global `Depends(get_current_user)` and verifies the bearer itself.
Every tools/call runs as `person:<username>` from source "mcp", so the
permission ladder, rehearsal and entitlements bind exactly as for that person.

Hand-rolled JSON-RPC on purpose: the `mcp` package is not a dependency of the
hub image and the protocol surface we need is five methods.
"""
from __future__ import annotations

import json
import time
from collections import deque
from threading import Lock
from typing import Any, Optional

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from core import actions as _actions
from core.logger_module import log_error
from services import external_tokens, rehearsal

router = APIRouter()

PROTOCOL_VERSION = "2025-06-18"
KNOWN_PROTOCOL_VERSIONS = frozenset({"2024-11-05", "2025-03-26", "2025-06-18"})
SERVER_INFO = {"name": "ziggy", "version": "3.0"}
INSTRUCTIONS = (
    "Ziggy is a real smart home, and these tools act on real devices in it: "
    "lights, climate, locks, cameras, automations. Read tools (query_devices, "
    "room_occupancy, list_automations, …) are safe to call freely; act and "
    "config tools change the home, so state what you are about to do, and "
    "always ask the person before touching locks or anything they would not "
    "expect. Device ids are never guessed: call query_devices first and use "
    "the exact ids it returns. A result with needs_approval means the home's "
    "policy wants a human to confirm — relay that to the person, do not retry "
    "with confirmed=true on your own."
)

# Rate limit: 60 calls/min per token (sliding window, in memory).
_RATE_WINDOW_S = 60
_RATE_MAX = 60
_hits: dict[int, deque[float]] = {}
_hits_lock = Lock()

# JSON-RPC error codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


# ── helpers ─────────────────────────────────────────────────────────────────
def _rate_check(token_id: int) -> Optional[int]:
    """Return seconds-to-retry when over the limit, else None (and count the hit)."""
    now = time.time()
    cutoff = now - _RATE_WINDOW_S
    with _hits_lock:
        dq = _hits.setdefault(token_id, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= _RATE_MAX:
            return max(1, int(dq[0] + _RATE_WINDOW_S - now))
        dq.append(now)
    return None


def _jsonable(value: Any) -> Any:
    """Round-trip through JSON so anything exotic (datetime, Enum…) becomes a string."""
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return str(value)


def _ok(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _err(req_id: Any, code: int, message: str, data: Any = None) -> dict:
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


def _tool_listing() -> list[dict]:
    return [
        {"name": a.name, "description": a.description or "", "inputSchema": a.params}
        for a in _actions.registry.list()
    ]


# ── method handlers ─────────────────────────────────────────────────────────
def _initialize(params: dict) -> dict:
    asked = params.get("protocolVersion")
    version = asked if isinstance(asked, str) and asked in KNOWN_PROTOCOL_VERSIONS else PROTOCOL_VERSION
    return {
        "protocolVersion": version,
        "capabilities": {"tools": {"listChanged": False}},
        "serverInfo": dict(SERVER_INFO),
        "instructions": INSTRUCTIONS,
    }


async def _tools_call(params: dict, *, username: str) -> tuple[Optional[dict], Optional[dict]]:
    """Returns (result, error) — exactly one is set."""
    name = params.get("name")
    arguments = params.get("arguments", {})
    if not isinstance(name, str) or not name:
        return None, {"code": INVALID_PARAMS, "message": "params.name must be a non-empty string"}
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        return None, {"code": INVALID_PARAMS, "message": "params.arguments must be an object"}
    if _actions.registry.get(name) is None:
        return None, {"code": INVALID_PARAMS, "message": f"unknown tool: {name}",
                      "data": {"tools": _actions.registry.names()}}

    # Rehearsal applies to external agents exactly as to chat / app actions.
    rehearsal.activate_if_enabled()
    envelope = await _actions.run_action(name, arguments, actor=f"person:{username}", source="mcp")
    if not isinstance(envelope, dict):
        envelope = {"ok": bool(envelope), "message": str(envelope)}
    structured = _jsonable(envelope)
    text = envelope.get("message") or ""
    if not isinstance(text, str) or not text.strip():
        text = json.dumps(structured, ensure_ascii=False, separators=(",", ":"))
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": structured,
        "isError": not bool(envelope.get("ok")),
    }, None


async def _dispatch(msg: Any, *, username: str) -> Optional[dict]:
    """Handle one JSON-RPC message. None → notification (nothing to send back)."""
    if not isinstance(msg, dict):
        return _err(None, INVALID_REQUEST, "request must be a JSON object")
    req_id = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    is_notification = "id" not in msg

    if msg.get("jsonrpc") != "2.0" or not isinstance(method, str):
        return None if is_notification else _err(req_id, INVALID_REQUEST, "invalid JSON-RPC 2.0 request")
    if not isinstance(params, dict):
        return None if is_notification else _err(req_id, INVALID_PARAMS, "params must be an object")

    if method.startswith("notifications/"):
        return None

    try:
        if method == "initialize":
            return _ok(req_id, _initialize(params))
        if method == "ping":
            return _ok(req_id, {})
        if method == "tools/list":
            return _ok(req_id, {"tools": _tool_listing()})
        if method == "tools/call":
            result, error = await _tools_call(params, username=username)
            if error is not None:
                return _err(req_id, error["code"], error["message"], error.get("data"))
            return _ok(req_id, result)
    except Exception as e:  # never let one call take the transport down
        log_error(f"[mcp] {method} failed: {e}")
        return _err(req_id, INTERNAL_ERROR, "internal error", {"detail": str(e)})

    return None if is_notification else _err(req_id, METHOD_NOT_FOUND, f"method not found: {method}")


# ── transport ───────────────────────────────────────────────────────────────
def _authenticate(request: Request) -> Optional[dict]:
    auth = request.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    try:
        return external_tokens.verify(token)
    except Exception as e:
        log_error(f"[mcp] token verify failed: {e}")
        return None


@router.post("/mcp")
async def mcp_post(request: Request):
    ident = _authenticate(request)
    if not ident:
        return JSONResponse({"error": "unauthorized"}, status_code=401,
                            headers={"WWW-Authenticate": "Bearer"})
    retry = _rate_check(int(ident["id"]))
    if retry is not None:
        return JSONResponse({"error": "rate_limited", "retry_after": retry}, status_code=429,
                            headers={"Retry-After": str(retry)})

    raw = await request.body()
    try:
        payload = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    except Exception:
        return JSONResponse(_err(None, PARSE_ERROR, "parse error"), status_code=200)

    username = ident["username"]
    if isinstance(payload, list):
        if not payload:
            return JSONResponse(_err(None, INVALID_REQUEST, "empty batch"), status_code=200)
        responses = []
        for item in payload:
            out = await _dispatch(item, username=username)
            if out is not None:
                responses.append(out)
        if not responses:                    # all notifications
            return Response(status_code=202)
        return JSONResponse(responses, status_code=200)

    out = await _dispatch(payload, username=username)
    if out is None:
        return Response(status_code=202)
    return JSONResponse(out, status_code=200)


@router.get("/mcp")
async def mcp_get():
    return JSONResponse(
        {"error": "method_not_allowed",
         "hint": "This MCP endpoint speaks Streamable HTTP with JSON responses only; "
                 "SSE streams are not offered. POST JSON-RPC 2.0 messages to /mcp."},
        status_code=405,
        headers={"Allow": "POST, DELETE"},
    )


@router.delete("/mcp")
async def mcp_delete():
    return Response(status_code=204)
