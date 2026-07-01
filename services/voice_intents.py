"""
Voice-intent phrase registry (Ziggy Pro Mode — voice primitive).

A "voice intent" is a short spoken/typed phrase ("good night", "לילה טוב")
mapped to a concrete Ziggy action. The registry lets those phrases be
recognized in core.intent_parser's short-circuit path WITHOUT an LLM call —
a pure normalized-phrase lookup — then executed by
core.handlers.automation_handler.handle_run_voice_intent.

Design
------
* Storage: the file-backed KV store (services.local_automation_actions),
  namespace "voice_intents", keyed by the NORMALIZED phrase. One phrase →
  one action. Re-registering the same phrase replaces it (idempotent).

* Matching is EXACT on the normalized form (lowercased, whitespace-collapsed,
  trailing punctuation stripped). No fuzzy matching in v1 — a false positive
  that silently fires "turn everything off" is far worse than a miss that
  falls through to the normal parser.

* An `action` is one of:
    {"kind": "intent",     "intent": "<name>", "params": {...}}   # re-dispatch
    {"kind": "automation", "automation_id": "<id>", "label": "<name>"}
    {"kind": "kv_mode",    "namespace": "modes", "key": "<flag>", "value": true}

Bundle voice_intents arrive from the designer as
{"phrase": ..., "action_description": <free text>}. resolve_action_description()
maps that free text to a concrete action deterministically (no LLM) for the
common cases; anything it can't resolve returns None so the caller can keep the
honest "manual setup needed" note for that one phrase.
"""
from __future__ import annotations

import re
import time
from typing import Optional

from services.local_automation_actions import (
    set_local_state,
    get_local_state,
    _load_state,
)
from core.logger_module import log_info


_KV_NAMESPACE = "voice_intents"

# Phrases (normalized) that mean "shut the home down". Used ONLY as a fallback
# when the phrase can't bind to a mode/automation the bundle created — a bundle
# that made a `modes.sleep` flag wants "good night" to ACTIVATE that flag, not
# blindly kill every device. So these are the last resort, not the first.
_ALL_OFF_HINTS = (
    "turn off everything", "everything off", "all off", "turn everything off",
    "shut down", "shut everything down", "lights off everywhere",
    "good night", "goodnight",
    "כבה הכל", "תכבה הכל", "כבה את הכל", "לילה טוב",
)


def normalize(phrase: str) -> str:
    """Canonical form for matching: lowercased, whitespace-collapsed, trailing
    punctuation stripped. Keeps Hebrew intact (only strips ASCII punctuation +
    the Hebrew geresh/gershayim used as quotes)."""
    if not isinstance(phrase, str):
        return ""
    s = phrase.strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = s.strip(" \t\r\n.!?,;:־-\"'׳״`")
    return s


def register_voice_intent(phrase: str, action: dict, *,
                          bundle_id: Optional[str] = None,
                          description: Optional[str] = None) -> dict:
    """Register (or replace) a phrase → action mapping.

    Returns {"ok": bool, "normalized": str, "error"?: str}.
    """
    norm = normalize(phrase)
    if not norm:
        return {"ok": False, "error": "empty phrase"}
    if not isinstance(action, dict) or not action.get("kind"):
        return {"ok": False, "error": "invalid action"}
    record = {
        "phrase":      phrase.strip(),
        "normalized":  norm,
        "action":      action,
        "bundle_id":   bundle_id,
        "description": description or "",
        "created_at":  time.time(),
    }
    set_local_state(_KV_NAMESPACE, norm, record)
    log_info(f"[voice_intents] registered phrase={norm!r} kind={action.get('kind')} bundle={bundle_id}")
    return {"ok": True, "normalized": norm}


def unregister_voice_intent(phrase: str) -> bool:
    """Remove a phrase by its (normalized) form. Returns True if it existed."""
    norm = normalize(phrase)
    if not norm:
        return False
    existing = get_local_state(_KV_NAMESPACE, norm)
    if existing is None:
        return False
    set_local_state(_KV_NAMESPACE, norm, None)
    log_info(f"[voice_intents] unregistered phrase={norm!r}")
    return True


def match(text: str) -> Optional[dict]:
    """Return the stored record for an exact normalized match, else None.

    This is the hot path called by the intent parser on every utterance, so it
    reads the KV once and does an O(1) dict lookup — no iteration."""
    norm = normalize(text)
    if not norm:
        return None
    rec = get_local_state(_KV_NAMESPACE, norm)
    return rec if isinstance(rec, dict) and rec.get("action") else None


def list_voice_intents() -> list[dict]:
    """All registered voice intents (for a management view / bundle sweep)."""
    state = _load_state()
    ns = (state.get(_KV_NAMESPACE) or {}) if isinstance(state, dict) else {}
    out = []
    for norm, rec in ns.items():
        if isinstance(rec, dict) and rec.get("action"):
            out.append(rec)
    out.sort(key=lambda r: r.get("created_at") or 0, reverse=True)
    return out


def resolve_action_description(action_description: str,
                               bundle_created: Optional[list[dict]] = None) -> Optional[dict]:
    """Best-effort DETERMINISTIC mapping of a designer's free-text
    action_description to a concrete action — no LLM.

    Resolution order (bundle-specific first, generic fallback last):
      1. A KV mode flag created in the same bundle whose key is named in the
         description (or the bundle's only mode) → set that mode. This is the
         flagship path: "good night" → the bundle's sleep mode ON.
      2. An automation created in the same bundle whose name appears in the
         description (or the bundle's only automation) → run it.
      3. Generic "all off / good night" language with nothing to bind to →
         turn_off_everything.
    Returns None when nothing maps cleanly (caller keeps the manual-setup note).
    """
    desc = normalize(action_description or "")
    if not desc:
        return None
    created = bundle_created or []

    # 1) KV mode flags created in this bundle (bundle intent beats generic all-off).
    kv_modes = [a for a in created if a.get("kind") == "kv_state"]
    if kv_modes:
        named = [a for a in kv_modes if a.get("key") and str(a["key"]).lower() in desc]
        target = named[0] if named else (kv_modes[0] if len(kv_modes) == 1 else None)
        if target:
            # Voice phrases almost always ACTIVATE a mode ("good night" → sleep on).
            # Default to True unless the description clearly says off/disable.
            turn_off = any(w in desc for w in ("off", "disable", "כבה", "בטל"))
            return {
                "kind": "kv_mode",
                "namespace": target.get("namespace") or "modes",
                "key": target.get("key"),
                "value": not turn_off,
            }

    # 2) Automations created in this bundle.
    autos = [a for a in created if a.get("kind") == "automation" and a.get("id")]
    if autos:
        named = [a for a in autos if a.get("name") and normalize(a["name"]) and normalize(a["name"]) in desc]
        target = named[0] if named else (autos[0] if len(autos) == 1 else None)
        if target:
            return {"kind": "automation", "automation_id": target["id"], "label": target.get("name") or ""}

    # 3) Generic all-off / goodnight language with nothing bundle-specific to bind.
    if any(h in desc for h in _ALL_OFF_HINTS):
        return {"kind": "intent", "intent": "turn_off_everything", "params": {}}

    return None
