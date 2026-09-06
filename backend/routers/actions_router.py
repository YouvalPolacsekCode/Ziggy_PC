"""Actions API — the app's side of the one action registry.

GET  /api/actions          → the catalog (name, description, params, risk, kind)
POST /api/actions/{name}   → run it as the signed-in user; returns the envelope

Same registry, same executors, same gates as the chat agent and /mcp.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user
from core.actions import registry, run_action
from services import rehearsal

router = APIRouter()


class RunActionBody(BaseModel):
    args: dict[str, Any] = {}
    lang: str | None = None


def _actor_of(user: dict | None) -> str | None:
    if isinstance(user, dict) and user.get("username"):
        return f"person:{user['username']}"
    return None


@router.get("/api/actions")
async def list_actions(user: dict = Depends(get_current_user)):
    return {"actions": [a.listing() for a in registry.list()]}


@router.post("/api/actions/{name}")
async def run_one(name: str, body: RunActionBody, request: Request,
                  user: dict = Depends(get_current_user)):
    if registry.get(name) is None:
        raise HTTPException(status_code=404, detail="unknown action")
    # Rehearsal applies to app actions exactly as to chat turns.
    rehearsal.activate_if_enabled()
    res = await run_action(name, body.args, actor=_actor_of(user), source="app",
                           lang=body.lang if body.lang in ("he", "en") else None)
    return {"ok": bool(res.get("ok")), "message": res.get("message", ""),
            "data": res.get("data"), "needs_approval": bool(res.get("needs_approval")),
            "result": {k: v for k, v in res.items() if k not in ("data",)}}
