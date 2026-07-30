"""
Walk-wizard capture sessions.

One active session at a time. While a session is active the listener hands
EVERY capture here (all protocols, known or not — the whole point is
cracking unknowns) instead of running its normal match/state pipeline, so
a walk never pollutes device state. Captures are stored in order with the
current step's analyzer label; user observations (what the AC displayed /
did) attach to captures per the step's semantics. finish() feeds the whole
ordered session to services/ir_walk_analyzer and registers the resulting
card as a CANDIDATE (rx/tx_validated False) — only the user-confirmed
validation pass may flip flags, via services/ir_card_registry.
"""
from __future__ import annotations

import base64
import json
import os
import time
import uuid
from typing import Any, Optional

from core.logger_module import log_error, log_info

WALK_SESSIONS_FILE = "user_files/ir_walk_sessions.json"

# The walk script. instruction_key values are owned by the frontend i18n.
WALK_SCRIPT: list[dict] = [
    {"id": "setup", "kind": "setup", "min_presses": 0,
     "needs_observation": "baseline", "observation_options": None},
    {"id": "baseline", "kind": "baseline", "min_presses": 1,
     "needs_observation": None, "observation_options": None},
    {"id": "ladder_down", "kind": "ladder_down", "min_presses": 3,
     "needs_observation": "temp", "observation_options": None},
    {"id": "ladder_up", "kind": "ladder_up", "min_presses": 3,
     "needs_observation": "temp", "observation_options": None},
    {"id": "mode_cycle", "kind": "mode_cycle", "min_presses": 1,
     "needs_observation": "mode",
     "observation_options": ["cool", "dry", "fan", "heat", "auto"]},
    {"id": "fan_cycle", "kind": "fan_cycle", "min_presses": 1,
     "needs_observation": "fan",
     "observation_options": ["low", "medium", "high", "auto"]},
    {"id": "swing", "kind": "swing", "min_presses": 1, "repeat_count": 2,
     "needs_observation": "swing", "observation_options": None},
    {"id": "power", "kind": "power", "min_presses": 1, "repeat_count": 4,
     "needs_observation": "power_result",
     "observation_options": ["turned_off", "turned_on"]},
]

_STEP_LABELS = {
    "baseline": "baseline", "ladder_down": "temp_down",
    "ladder_up": "temp_up", "mode_cycle": "mode", "fan_cycle": "fan",
    "swing": "swing", "power": "power",
}

_sessions: dict[str, dict] = {}
_active_id: Optional[str] = None


def _persist() -> None:
    try:
        os.makedirs(os.path.dirname(WALK_SESSIONS_FILE), exist_ok=True)
        with open(WALK_SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump({"sessions": _sessions, "active": _active_id}, f, indent=1)
    except Exception as e:
        log_error(f"[IRWalk] persist failed: {e}")


def _step_payload(session: dict) -> Optional[dict]:
    idx = session["step_index"]
    if idx >= len(WALK_SCRIPT):
        return None
    step = dict(WALK_SCRIPT[idx])
    step["instruction_key"] = f"irWalk.step.{step['id']}.instruction"
    step["done_button_key"] = f"irWalk.step.{step['id']}.done"
    return step


def _public(session: dict) -> dict:
    return {
        "session_id": session["id"],
        "status": session["status"],
        "step": _step_payload(session),
        "steps_total": len(WALK_SCRIPT),
        "step_index": session["step_index"],
        "captures_count": len(session["captures"]),
    }


def start_session(device_id: str) -> dict:
    global _active_id
    session = {
        "id": f"walk_{uuid.uuid4().hex[:10]}",
        "device_id": device_id,
        "status": "active",
        "created_at": time.time(),
        "step_index": 0,
        "captures": [],       # {seq, step_id, label, raw_b64, observed}
        "setup_observed": {},
        "step_obs_count": 0,  # observations recorded within the current step
        "result": None,
    }
    _sessions[session["id"]] = session
    _active_id = session["id"]
    _persist()
    log_info(f"[IRWalk] session {session['id']} started for {device_id}")
    return _public(session)


def get_session(session_id: str) -> Optional[dict]:
    s = _sessions.get(session_id)
    return _public(s) if s else None


def _raw_session(session_id: str) -> Optional[dict]:
    return _sessions.get(session_id)


def abort_session(session_id: str) -> bool:
    global _active_id
    s = _sessions.get(session_id)
    if not s:
        return False
    s["status"] = "aborted"
    if _active_id == session_id:
        _active_id = None
    _persist()
    return True


def try_consume_capture(received_bytes: bytes) -> Optional[dict]:
    """Called by the listener on EVERY capture. Returns a WS event dict if
    an active session consumed the capture (listener then skips its normal
    pipeline), else None."""
    if _active_id is None:
        return None
    s = _sessions.get(_active_id)
    if not s or s["status"] != "active":
        return None
    step = WALK_SCRIPT[s["step_index"]] if s["step_index"] < len(WALK_SCRIPT) else None
    if step is None or step["kind"] == "setup":
        return None  # setup takes no presses; stray signals flow normally

    payload_hex = payload2_hex = ""
    try:
        from services.ir_protocol import decode_protocol_bytes
        dec = decode_protocol_bytes(received_bytes)
        if dec:
            payload_hex = dec.payload_hex
            payload2_hex = getattr(dec, "payload2_hex", "") or ""
    except Exception:
        pass

    cap = {
        "seq": len(s["captures"]),
        "step_id": step["id"],
        "label": _STEP_LABELS.get(step["id"], step["id"]),
        "raw_b64": base64.b64encode(received_bytes).decode(),
        "payload_hex": payload_hex,
        "payload2_hex": payload2_hex,
        "observed": {},
        "at": time.time(),
    }
    # Duplicate suppression: the same press re-captured within 2s (remotes
    # re-send; the listener re-arms fast) must not count twice.
    prev = s["captures"][-1] if s["captures"] else None
    if prev and prev["raw_b64"] == cap["raw_b64"] and cap["at"] - prev["at"] < 2.0:
        return {"type": "ir_walk_capture", "session_id": s["id"],
                "step_label": cap["label"], "seq": prev["seq"],
                "payload_hex": payload_hex, "duplicate": True}
    if prev and prev["payload_hex"] and prev["payload_hex"] == payload_hex \
            and cap["at"] - prev["at"] < 2.0:
        return {"type": "ir_walk_capture", "session_id": s["id"],
                "step_label": cap["label"], "seq": prev["seq"],
                "payload_hex": payload_hex, "duplicate": True}

    s["captures"].append(cap)
    _persist()
    return {"type": "ir_walk_capture", "session_id": s["id"],
            "step_label": cap["label"], "seq": cap["seq"],
            "payload_hex": payload_hex, "duplicate": False}


def _advance(s: dict) -> None:
    s["step_index"] += 1
    s["step_obs_count"] = 0


def observe(session_id: str, observed: dict) -> Optional[dict]:
    """Record the user's answer for the current step and advance per the
    step's semantics."""
    s = _sessions.get(session_id)
    if not s or s["status"] != "active":
        return None
    idx = s["step_index"]
    if idx >= len(WALK_SCRIPT):
        return None
    step = WALK_SCRIPT[idx]
    kind = step["kind"]
    step_caps = [c for c in s["captures"] if c["step_id"] == step["id"]]

    if kind == "setup":
        s["setup_observed"] = dict(observed or {})
        _advance(s)

    elif kind == "baseline":
        _advance(s)

    elif kind in ("ladder_down", "ladder_up"):
        # observed {"temp": N} anchors the LAST capture of the ladder
        if step_caps and "temp" in (observed or {}):
            step_caps[-1]["observed"]["temp"] = observed["temp"]
        _advance(s)

    elif kind in ("mode_cycle", "fan_cycle"):
        if (observed or {}).get("done"):
            _advance(s)
        else:
            key = "mode" if kind == "mode_cycle" else "fan"
            unobserved = [c for c in step_caps if key not in c["observed"]]
            if unobserved and key in (observed or {}):
                unobserved[-1]["observed"][key] = observed[key]

    elif kind == "swing":
        unobserved = [c for c in step_caps if "swing" not in c["observed"]]
        if unobserved and "swing" in (observed or {}):
            unobserved[-1]["observed"]["swing"] = bool(observed["swing"])
            s["step_obs_count"] += 1
        if s["step_obs_count"] >= step.get("repeat_count", 1):
            _advance(s)

    elif kind == "power":
        unobserved = [c for c in step_caps if "result" not in c["observed"]]
        if unobserved and "result" in (observed or {}):
            unobserved[-1]["observed"]["result"] = observed["result"]
            s["step_obs_count"] += 1
        if s["step_obs_count"] >= step.get("repeat_count", 1):
            _advance(s)

    if s["step_index"] >= len(WALK_SCRIPT):
        s["status"] = "ready_to_finish"
    _persist()
    out = _public(s)
    out["done"] = s["status"] != "active"
    return out


def next_step(session_id: str) -> Optional[dict]:
    """Advance a step that needs no observation (baseline)."""
    return observe(session_id, {})


def _analyzer_steps(s: dict) -> list[dict]:
    steps = []
    setup = s.get("setup_observed") or {}
    for cap in s["captures"]:
        observed = dict(cap["observed"])
        if cap["label"] == "baseline" and setup:
            # baseline press was TEMP UP from the setup temp
            observed.setdefault("mode", setup.get("mode", "cool"))
            observed.setdefault("fan", setup.get("fan"))
            observed.setdefault("swing", bool(setup.get("swing", False)))
            try:
                observed.setdefault("temp", int(setup.get("temp", 24)) + 1)
            except (TypeError, ValueError):
                pass
        steps.append({"label": cap["label"], "raw_b64": cap["raw_b64"],
                      "observed": observed})
    return steps


def finish_session(session_id: str) -> Optional[dict]:
    """Run the analyzer, register the candidate card, pin it to the device
    in TRIAL mode (synthesis allowed only for the validation pass)."""
    global _active_id
    s = _sessions.get(session_id)
    if not s:
        return None
    from services.ir_walk_analyzer import analyze_walk_session
    from services import ir_card_registry as registry

    result = analyze_walk_session(_analyzer_steps(s))
    s["status"] = "done"
    if _active_id == session_id:
        _active_id = None

    card = result.get("card")
    card_id = None
    if card:
        card_id = registry.register_card(card)
        try:
            from services.ir_manager import update_ir_device
            update_ir_device(s["device_id"], {
                "protocol_card_id": card_id,
                "protocol_card_trial": True,
            })
        except Exception as e:
            log_error(f"[IRWalk] card pin failed: {e}")

    fields = (card or {}).get("fields") or {}
    temp = fields.get("temp") or {}
    summary = {
        "temps": f"{temp.get('min')}–{temp.get('max')}" if temp else None,
        "modes": sorted((fields.get("mode") or {}).get("map", {}).values()),
        "fans": sorted((fields.get("fan") or {}).get("map", {}).values()),
        "swing": "swing" in fields,
        "power": "power" in fields,
    }
    s["result"] = {
        "card_id": card_id,
        "confidence": result["confidence"],
        "unresolved": result["unresolved"],
        "report": result["report"],
        "summary": summary,
        "validation_commands": ["temp_up", "temp_down"] if temp else
                               (["power"] if "power" in fields else []),
    }
    _persist()
    log_info(f"[IRWalk] session {session_id} analyzed -> card={card_id} "
             f"confidence={result['confidence']:.2f}")
    return s["result"]


def validate_session(session_id: str, obeyed: bool) -> Optional[dict]:
    """The user watched the AC during the validation pass. Their verdict is
    the ONLY thing that flips validation flags — the real-life gate."""
    s = _sessions.get(session_id)
    if not s or not s.get("result") or not s["result"].get("card_id"):
        return None
    from services import ir_card_registry as registry
    from services.ir_manager import update_ir_device

    card_id = s["result"]["card_id"]
    # The walk itself is RX evidence: the user confirmed the displayed
    # values matched the AC at every observed step.
    registry.mark_validated(card_id, rx=True, tx=bool(obeyed))
    update_ir_device(s["device_id"], {"protocol_card_trial": False})
    _persist()
    return {"activated": bool(obeyed), "card_id": card_id}
