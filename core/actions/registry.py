"""Action registry — ground truth for "what can be done" in this home.

An Action is a named, described, JSON-schema'd unit of behaviour. Today every
action is an agent tool from core/agent/tools.py (adapter below): implement a
tool once and it is, at the same time,

  * a tool the chat/voice agent can call,
  * an app action (`GET /api/actions`, `POST /api/actions/{name}`),
  * an MCP tool for external agents (`/mcp`).

`run_action` is the single execution path for the app and MCP: it resolves the
device directory the tools need, executes under the caller's actor (permission
ladder + rehearsal contextvar already apply inside the tools), journals the
call for the agent's context, and broadcasts `ziggy_action` so screens react.
The chat runner calls the tools directly (it already has the directory) and
announces through the same `announce()` so the two paths stay identical from
the app's point of view.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from core.logger_module import log_error, log_info

# Tools whose result the chat renders as an interactive card (see
# frontend/src/components/chat/ChatCards.jsx). Mirrored in the runner.
CARD_KINDS = frozenset({
    "device_list", "automations", "capabilities", "why_not", "home_health",
    "down_devices", "repair_history", "recent_activity", "camera_look",
    "needs_approval", "pairing_diagnosis", "cause_trace", "device_diagnosis",
})

# risk hints for the app / MCP listing: "read" never changes the home,
# "act" changes device state, "config" changes what the home does over time.
_READ_TOOLS = frozenset({
    "query_devices", "room_occupancy", "get_temperature", "is_someone_home",
    "list_tasks", "list_automations", "get_active_anomalies", "web_search",
    "camera_look", "check_home_health", "diagnose_device", "list_down_devices",
    "diagnose_pairing", "explain_device_change", "what_can_ziggy_do",
    "recent_activity", "explain_missing_action", "repair_history",
})
_CONFIG_TOOLS = frozenset({
    "create_automation", "design_automation", "design_smart_room", "add_task",
    "toggle_automation", "delete_automation", "acknowledge_alerts",
})


@dataclass(frozen=True)
class Action:
    name: str
    description: str
    params: dict                       # JSON schema (tool "parameters")
    run: Callable[..., Awaitable[dict]]
    risk: str = "act"                  # read | act | config
    kind: Optional[str] = None         # card kind the result renders as, if any
    source: str = "tool"

    def listing(self) -> dict:
        return {"name": self.name, "description": self.description,
                "params": self.params, "risk": self.risk, "kind": self.kind}


class Registry:
    def __init__(self) -> None:
        self._actions: dict[str, Action] = {}

    def register(self, action: Action) -> None:
        self._actions[action.name] = action

    def get(self, name: str) -> Optional[Action]:
        return self._actions.get(name)

    def list(self) -> list[Action]:
        return [self._actions[k] for k in sorted(self._actions)]

    def names(self) -> list[str]:
        return sorted(self._actions)


registry = Registry()


# ── Adapter: every agent tool is an action ───────────────────────────────────
_TOOL_KIND = {
    "query_devices": "device_list", "list_automations": "automations",
    "what_can_ziggy_do": "capabilities", "explain_missing_action": "why_not",
    "check_home_health": "home_health", "list_down_devices": "down_devices",
    "repair_history": "repair_history", "recent_activity": "recent_activity",
    "camera_look": "camera_look", "diagnose_pairing": "pairing_diagnosis",
    "explain_device_change": "cause_trace", "diagnose_device": "device_diagnosis",
}


def _risk_for(name: str) -> str:
    if name in _READ_TOOLS:
        return "read"
    if name in _CONFIG_TOOLS:
        return "config"
    return "act"


def _build_from_tools() -> None:
    from core.agent import tools as _tools

    for schema in _tools.TOOL_SCHEMAS:
        fn = schema.get("function") or {}
        name = fn.get("name")
        if not name:
            continue

        async def _run(args: dict, *, directory: dict, actor: Optional[str], lang: str,
                       _name: str = name) -> dict:
            return await _tools.execute_tool(_name, dict(args or {}), directory,
                                             lang=lang, actor=actor)

        registry.register(Action(
            name=name,
            description=fn.get("description") or "",
            params=fn.get("parameters") or {"type": "object", "properties": {}},
            run=_run,
            risk=_risk_for(name),
            kind=_TOOL_KIND.get(name),
        ))


_build_from_tools()


# ── Execution path for the app and MCP ──────────────────────────────────────
async def announce(name: str, args: dict, result: dict, *, actor: Optional[str],
                   source: str) -> None:
    """Broadcast `ziggy_action` so open screens react. Never raises."""
    try:
        from backend.ws_manager import manager
        data = result.get("data") if isinstance(result, dict) else None
        await manager.broadcast({
            "type": "ziggy_action", "name": name, "args": args,
            "ok": bool((result or {}).get("ok")),
            "kind": (data or {}).get("kind") if isinstance(data, dict) else None,
            "actor": actor, "source": source, "ts": time.time(),
        })
    except Exception as e:
        log_error(f"[actions] announce failed: {e}")


def _is_hebrew(text: str) -> bool:
    return any("֐" <= c <= "׿" for c in (text or ""))


async def run_action(name: str, args: Optional[dict] = None, *, actor: Optional[str] = None,
                     source: str = "app", lang: Optional[str] = None,
                     directory: Optional[dict] = None) -> dict:
    """Run one action as `actor` from `source` ("app" | "mcp" | "voice"…).

    Returns the tool envelope {ok, message, data, …}. Unknown action → ok=False.
    """
    action = registry.get(name)
    if action is None:
        return {"ok": False, "message": f"unknown action {name}", "unknown_action": True}
    args = dict(args or {})
    if lang is None:
        lang = "he" if any(_is_hebrew(str(v)) for v in args.values()) else "en"
    if directory is None:
        try:
            from core.agent import directory as _dir
            directory = await _dir.build_directory()
        except Exception as e:
            log_error(f"[actions] directory build failed: {e}")
            directory = {"devices": [], "presence": [], "cameras": [], "by_room": {}}
    t0 = time.perf_counter()
    try:
        result = await action.run(args, directory=directory, actor=actor, lang=lang)
    except Exception as e:
        log_error(f"[actions] {name} failed: {e}")
        result = {"ok": False, "message": str(e)}
    log_info(f"[actions] {source} {actor or '-'} {name} ok={result.get('ok')} "
             f"{(time.perf_counter() - t0) * 1000:.0f}ms")
    if action.risk != "read":
        try:
            from services import ui_journal
            ui_journal.record(name, args, actor=actor, source=source,
                              label=(result.get("message") or "")[:80], ok=bool(result.get("ok")))
        except Exception:
            pass
    await announce(name, args, result, actor=actor, source=source)
    return result
